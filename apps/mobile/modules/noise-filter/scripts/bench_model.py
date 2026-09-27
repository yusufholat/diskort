"""DPDFNet ONNX modelinin kare başına süresi ve çıkış eşdeğerliği (telefonsuz vekil ölçüm).

Telefondaki çalıştırmanın aynısı: tek iş parçacığı, boşta dönme yok, tüm grafik iyileştirmeleri, durum
her karede bir sonrakine aktarılır. İki ölçüm yapılır:
  - sıcak: ağırlıklar önbellekte (masaüstü işlemcilerinde olan)
  - soğuk: her kareden önce 64 MB bellek dolaşılır, ağırlıklar önbellekten atılır (telefonda olan:
    10 MB'lık model, telefonun L2/L3 önbelleğine sığmaz ve iki kare arasında başka işler de çalışır)
Aday modellerin çıkışı referans modelinkiyle karşılaştırılır (SNR, dB; > 60 dB = aynı sonuç).

Kullanım: python bench_model.py --ref asıl.onnx [aday.onnx ...] [--ep cpu,xnnpack] [--threads 1,2]
Gerekenler: pip install onnxruntime numpy
"""
import argparse
import os
import platform
import time

import numpy as np
import onnxruntime as ort


def session(path, ep, threads, profile=False):
    so = ort.SessionOptions()
    so.enable_profiling = profile
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.add_session_config_entry("session.intra_op.allow_spinning", "0")
    so.add_session_config_entry("session.inter_op.allow_spinning", "0")
    so.add_session_config_entry("session.set_denormal_as_zero", "1")
    if ep == "xnnpack":
        providers = [("XnnpackExecutionProvider", {"intra_op_num_threads": str(threads)}), "CPUExecutionProvider"]
        so.intra_op_num_threads = 1
    else:
        providers = ["CPUExecutionProvider"]
    return ort.InferenceSession(path, so, providers=providers)


def initial_state(sess):
    meta = sess.get_modelmeta().custom_metadata_map
    st = np.zeros(int(meta["state_size"]), np.float32)
    erb = np.array([float(v) for v in meta["erb_norm_init"].split(",")], np.float32)
    spec = np.array([float(v) for v in meta["spec_norm_init"].split(",")], np.float32)
    e = int(meta["erb_norm_state_size"])
    st[: len(erb)] = erb
    st[e : e + len(spec)] = spec
    return st


def names(sess):
    ins = sess.get_inputs()
    outs = sess.get_outputs()
    spec_in = next(i.name for i in ins if len(i.shape) == 4)
    state_in = next(i.name for i in ins if len(i.shape) != 4)
    spec_out = next(o.name for o in outs if len(o.shape) == 4)
    state_out = next(o.name for o in outs if len(o.shape) != 4)
    return spec_in, state_in, spec_out, state_out


def frames(n, seed=1):
    """Konuşmaya benzer seviye değişimli, rastgele spektrumlar (sessizlik de var)."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        level = 10 ** rng.uniform(-4, -0.5) if (i // 50) % 4 else 1e-5
        out.append((rng.standard_normal((1, 1, 481, 2)) * level).astype(np.float32))
    return out


def run(sess, specs, cold=False):
    si, sti, so_, sto = names(sess)
    st = initial_state(sess)
    junk = np.ones(16 * 1024 * 1024, np.float32) if cold else None
    ys, times = [], []
    for s in specs:
        if cold:
            junk += 1.0
        t = time.perf_counter()
        out = sess.run([so_, sto], {si: s, sti: st})
        times.append(time.perf_counter() - t)
        ys.append(out[0])
        st = out[1]
    return np.stack(ys), np.array(times[50:]) * 1000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    ap.add_argument("models", nargs="*")
    ap.add_argument("--ep", default="cpu")
    ap.add_argument("--threads", default="1")
    ap.add_argument("--frames", type=int, default=1000)
    ap.add_argument("--profile", action="store_true", help="işlem türüne göre süre dağılımı (ORT profili)")
    a = ap.parse_args()
    print(f"# {platform.machine()} {platform.processor()} onnxruntime {ort.__version__} {ort.get_available_providers()}")
    try:
        with open("/proc/cpuinfo") as f:
            parts = [l.split(":")[1].strip() for l in f if l.startswith(("CPU part", "model name"))]
            print("# cpu:", sorted(set(parts)))
    except OSError:
        pass
    specs = frames(a.frames)
    ref_y, _ = run(session(a.ref, "cpu", 1), specs[:600])
    print(f"{'model':34s} {'ep':8s} thr  hot med/mean ms   cold med/mean ms   SNR vs ref")
    for path in [a.ref] + a.models:
        for ep in a.ep.split(","):
            if ep == "xnnpack" and "XnnpackExecutionProvider" not in ort.get_available_providers():
                continue
            for thr in [int(t) for t in a.threads.split(",")]:
                sess = session(path, ep, thr)
                y, _ = run(sess, specs[:600])
                err = y - ref_y
                snr = 10 * np.log10((ref_y**2).sum() / max((err**2).sum(), 1e-30))
                res = []
                for rep in range(2):
                    _, hot = run(sess, specs)
                    _, cold = run(sess, specs[:500], cold=True)
                    res.append((np.median(hot), hot.mean(), np.median(cold), cold.mean()))
                hm, ha, cm, ca = min(res)
                print(f"{os.path.basename(path):34s} {ep:8s} {thr:3d}  {hm:6.3f} / {ha:6.3f}    {cm:6.3f} / {ca:6.3f}    {snr:6.1f} dB", flush=True)

    if a.profile:
        import collections
        import json

        for path in [a.ref] + a.models:
            for ep in a.ep.split(","):
                if ep == "xnnpack" and "XnnpackExecutionProvider" not in ort.get_available_providers():
                    continue
                sess = session(path, ep, 1, profile=True)
                run(sess, specs[:300])
                events = json.load(open(sess.end_profiling()))
                by_op, by_ep = collections.Counter(), collections.Counter()
                for e in events:
                    if e.get("cat") == "Node" and e["name"].endswith("_kernel_time"):
                        by_op[e["args"]["op_name"]] += e["dur"]
                        by_ep[e["args"].get("provider", "?")] += e["dur"]
                total = sum(by_op.values())
                print(f"# profil {os.path.basename(path)} {ep}: " + ", ".join(f"{k} {100 * v / total:.0f}%" for k, v in by_ep.items()))
                print("   " + ", ".join(f"{k} {100 * v / total:.1f}%" for k, v in by_op.most_common(14)))


if __name__ == "__main__":
    main()
