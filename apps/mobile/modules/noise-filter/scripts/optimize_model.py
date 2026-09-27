"""DPDFNet ONNX modeli için çevrimdışı grafik dönüşümleri.

  --int8-all        Sabit ağırlıklı tüm Gemm/MatMul düğümlerini (GRUCell'ler, tam bağlı katmanlar) dinamik
                    int8'e çevirir: ağırlıklar sütun başına simetrik int8, etkinlikler her karede uint8'e
                    (com.microsoft DynamicQuantizeMatMul). Telefondaki model budur:
                      python optimize_model.py <masaüstündeki dpdfnet2_48khz_hr.onnx> \\
                        ../android/src/main/assets/dpdfnet2_48khz_hr_int8.onnx --int8-all
                    Çıktı belirlenimcidir (aynı girişten bayt bayt aynı dosya).
  --int8-gru-cells  Yalnızca GRUCell'lerin büyük (≥ 100k) matrisleri (deneme).
  --fuse-gru-cells  PyTorch GRUCell'in açık hâlini (2 Gemm + Split + Sigmoid/Tanh ... 14 düğüm) tek bir
                    ONNX GRU düğümüne (linear_before_reset=1) çevirir. Matematik aynı (çıkış farkı ~1e-7)
                    ama ARM64'te hızlandırmadı (bench_model.py), kullanılmıyor.

Kullanım: python optimize_model.py giriş.onnx çıkış.onnx [--int8-all] [--int8-gru-cells] [--fuse-gru-cells]
Gerekenler: pip install onnx numpy
"""
import argparse
import collections

import numpy as np
import onnx
from onnx import helper, numpy_helper


def _index(g):
    prod = {o: n for n in g.node for o in n.output}
    cons = collections.defaultdict(list)
    for n in g.node:
        for i in n.input:
            cons[i].append(n)
    return prod, cons


def _attrs(n):
    return {a.name: helper.get_attribute_value(a) for a in n.attribute}


def _replace(g, nodes, removed, inserted, new_inits):
    # nodes: aynı liste (protobuf sarmalayıcılarının id()'leri ancak canlı tutulurlarsa sabittir)
    out = []
    for n in nodes:
        if id(n) in inserted:
            out.extend(inserted[id(n)])
        if id(n) not in removed:
            out.append(n)
    del g.node[:]
    g.node.extend(out)
    g.initializer.extend(new_inits)
    used = {i for n in g.node for i in n.input}
    keep = [t for t in g.initializer if t.name in used]
    del g.initializer[:]
    g.initializer.extend(keep)


def int8_gru_cells(m, min_size=100_000, everything=False):
    """everything: GRUCell'lerle sınırlı kalma, sabit ağırlıklı her Gemm/MatMul (min_size'dan büyük)."""
    g = m.graph
    init = {t.name: t for t in g.initializer}
    nodes = list(g.node)
    removed, inserted, new_inits = set(), {}, []
    for n in nodes:
        if n.op_type not in ("Gemm", "MatMul") or len(n.input) < 2 or n.input[1] not in init:
            continue
        if not everything and (n.op_type != "Gemm" or "grucell" not in n.name):
            continue
        at = _attrs(n)
        if at.get("transA", 0) or at.get("alpha", 1.0) != 1.0 or at.get("beta", 1.0) != 1.0:
            continue
        w = numpy_helper.to_array(init[n.input[1]])
        if w.ndim != 2 or (n.op_type == "Gemm" and len(n.input) > 2 and n.input[2] in init and numpy_helper.to_array(init[n.input[2]]).ndim != 1):
            continue
        if at.get("transB", 0):
            w = w.T  # [K, N]
        if w.size < min_size:
            continue
        scale = np.abs(w).max(0) / 127.0
        scale[scale == 0] = 1e-8
        q = np.clip(np.round(w / scale), -127, 127).astype(np.int8)
        p = n.name
        new_inits += [
            numpy_helper.from_array(q, p + "/Wq"),
            numpy_helper.from_array(scale.astype(np.float32), p + "/Ws"),
            numpy_helper.from_array(np.zeros(w.shape[1], np.int8), p + "/Wz"),
        ]
        ins = [n.input[0], p + "/Wq", p + "/Ws", p + "/Wz"] + list(n.input[2:3])
        inserted[id(n)] = [helper.make_node("DynamicQuantizeMatMul", ins, list(n.output), name=p + "_q", domain="com.microsoft")]
        removed.add(id(n))
    _replace(g, nodes, removed, inserted, new_inits)
    if not any(o.domain == "com.microsoft" for o in m.opset_import):
        m.opset_import.append(helper.make_opsetid("com.microsoft", 1))
    return len(removed)


def fuse_gru_cells(m):
    g = m.graph
    init = {t.name: t for t in g.initializer}
    prod, cons = _index(g)  # (düğüm sarmalayıcılarını da canlı tutar)

    def arr(name):
        return numpy_helper.to_array(init[name])

    nodes = list(g.node)
    removed, inserted, new_inits = set(), {}, []
    for mul_r in nodes:
        # r ⊙ h_n: girişler (Split_hh[2], Sigmoid_r)
        if mul_r.op_type != "Mul":
            continue
        pa, pb = prod.get(mul_r.input[0]), prod.get(mul_r.input[1])
        if not (pa and pb and pa.op_type == "Split" and pb.op_type == "Sigmoid" and list(pa.output).index(mul_r.input[0]) == 2):
            continue
        split_hh, sig_r = pa, pb
        add_r = prod[sig_r.input[0]]
        gemm_hh = prod[split_hh.input[0]]
        other = [x for x in add_r.input if prod.get(x) is not split_hh]
        if add_r.op_type != "Add" or gemm_hh.op_type != "Gemm" or len(other) != 1:
            continue
        split_ih = prod[other[0]]
        gemm_ih = prod[split_ih.input[0]]
        if split_ih.op_type != "Split" or gemm_ih.op_type != "Gemm":
            continue
        (add_n,) = cons[mul_r.output[0]]
        (tanh,) = cons[add_n.output[0]]
        (add_z,) = cons[split_hh.output[1]]
        (sig_z,) = cons[add_z.output[0]]
        (sub,) = [c for c in cons[tanh.output[0]] if c.op_type == "Sub"]
        (mul_z,) = cons[sub.output[0]]
        (add_out,) = cons[mul_z.output[0]]
        h_in = sub.input[0]
        ok = (
            add_n.op_type == "Add" and split_ih.output[2] in add_n.input and tanh.op_type == "Tanh"
            and add_z.op_type == "Add" and split_ih.output[1] in add_z.input and sig_z.op_type == "Sigmoid"
            and sub.input[1] == tanh.output[0] and gemm_hh.input[0] == h_in
            and mul_z.op_type == "Mul" and sig_z.output[0] in mul_z.input
            and add_out.op_type == "Add" and tanh.output[0] in add_out.input
            and split_ih.output[0] in add_r.input
        )
        for gm in (gemm_ih, gemm_hh):
            at = _attrs(gm)
            ok = ok and at.get("transB") == 1 and at.get("transA", 0) == 0 and at.get("alpha", 1.0) == 1.0 and at.get("beta", 1.0) == 1.0
        if not ok:
            continue
        cell = [gemm_ih, gemm_hh, split_ih, split_hh, add_r, sig_r, mul_r, add_n, tanh, add_z, sig_z, sub, mul_z, add_out]
        internal = {o for c in cell for o in c.output} - {add_out.output[0]}
        if any(c not in cell for o in internal for c in cons[o]):
            continue
        w_ih, b_ih = arr(gemm_ih.input[1]), arr(gemm_ih.input[2])
        w_hh, b_hh = arr(gemm_hh.input[1]), arr(gemm_hh.input[2])
        h = w_hh.shape[1]

        def zrh(w):  # PyTorch r,z,n → ONNX z,r,h
            return np.concatenate([w[h : 2 * h], w[0:h], w[2 * h : 3 * h]], 0)

        p = gemm_ih.name.rsplit("/", 1)[0] + "/fused_gru"
        new_inits += [
            numpy_helper.from_array(zrh(w_ih)[None].astype(np.float32), p + "/W"),
            numpy_helper.from_array(zrh(w_hh)[None].astype(np.float32), p + "/R"),
            numpy_helper.from_array(np.concatenate([zrh(b_ih), zrh(b_hh)])[None].astype(np.float32), p + "/B"),
            numpy_helper.from_array(np.array([0], np.int64), p + "/axes0"),
        ]
        inserted[id(add_out)] = [
            helper.make_node("Unsqueeze", [gemm_ih.input[0], p + "/axes0"], [p + "/x3"], name=p + "/UnsqX"),
            helper.make_node("Unsqueeze", [h_in, p + "/axes0"], [p + "/h3"], name=p + "/UnsqH"),
            helper.make_node("GRU", [p + "/x3", p + "/W", p + "/R", p + "/B", "", p + "/h3"], ["", p + "/yh"],
                             name=p + "/GRU", hidden_size=h, linear_before_reset=1),
            helper.make_node("Squeeze", [p + "/yh", p + "/axes0"], [add_out.output[0]], name=p + "/Sq"),
        ]
        removed.update(id(c) for c in cell)
    _replace(g, nodes, removed, inserted, new_inits)
    return len(inserted)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--fuse-gru-cells", action="store_true")
    ap.add_argument("--int8-gru-cells", action="store_true")
    ap.add_argument("--int8-all", action="store_true", help="sabit ağırlıklı tüm Gemm/MatMul int8")
    a = ap.parse_args()
    m = onnx.load(a.src)
    before = len(m.graph.node)
    changes = []
    if a.int8_all:
        n = int8_gru_cells(m, min_size=0, everything=True)
        changes.append(f"{n} Gemm/MatMul -> DynamicQuantizeMatMul (int8 weights, per-column scale)")
    elif a.int8_gru_cells:
        n = int8_gru_cells(m)
        changes.append(f"{n} GRUCell Gemm -> DynamicQuantizeMatMul (int8 weights, per-column scale)")
    if a.fuse_gru_cells:
        n = fuse_gru_cells(m)
        changes.append(f"{n} GRUCell subgraphs -> ONNX GRU")
    print("\n".join(changes))
    if changes:
        # Apache 2.0 madde 4(b): değiştirilen dosya bunu belirtmeli
        meta = {p.key: p for p in m.metadata_props}
        note = "Modified by Diskort (apps/mobile/modules/noise-filter/scripts/optimize_model.py): " + "; ".join(changes)
        if "modified" in meta:
            meta["modified"].value = note
        else:
            m.metadata_props.append(onnx.StringStringEntryProto(key="modified", value=note))
    onnx.checker.check_model(m)
    onnx.save(m, a.dst)
    print(f"nodes: {before} -> {len(m.graph.node)}")


if __name__ == "__main__":
    main()
