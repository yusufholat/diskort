import { useEffect, useState } from 'react';
import { api, errorMessage, parseReleaseNotes, type NotePart } from '@diskort/client-core';
import type { ReleaseNotes } from '@diskort/shared';
import { Skeleton } from '../ui/Skeleton';

const dateFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

function Parts({ parts }: { parts: NotePart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-semibold text-text-head">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Ayarlar → Yenilikler: yayınlanmış sürümlerin notları (açılışta bildirim olarak gösterilmez). */
export function WhatsNewSection() {
  const [releases, setReleases] = useState<ReleaseNotes[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .releaseNotes()
      .then(setReleases)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div>
      <h2 className="mb-5 text-xl font-bold text-text-head">Yenilikler</h2>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!releases && !error && (
        <div className="flex flex-col gap-2.5">
          {[70, 90, 55, 80].map((w, i) => (
            <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      {releases?.length === 0 && <p className="text-sm text-text-muted">Henüz sürüm notu yok.</p>}
      <div className="flex flex-col gap-4">
        {releases?.map((r, index) => (
          <article key={r.version} className="rounded-lg bg-bg-side p-4">
            <header className="mb-2 flex items-baseline gap-2">
              <h3 className="text-lg font-bold text-text-head">Diskort {r.version}</h3>
              {index === 0 && (
                <span className="rounded bg-brand px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">Son</span>
              )}
              <span className="ml-auto text-xs text-text-muted">{dateFormat.format(new Date(r.publishedAt))}</span>
            </header>
            <div className="flex flex-col gap-1 text-[14.5px] leading-relaxed text-text-normal">
              {parseReleaseNotes(r.notes).map((b, i) =>
                b.kind === 'heading' ? (
                  <h4 key={i} className="mt-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                    {b.text}
                  </h4>
                ) : b.kind === 'item' ? (
                  <div key={i} className="flex gap-2">
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" />
                    <p>
                      <Parts parts={b.parts} />
                    </p>
                  </div>
                ) : (
                  <p key={i}>
                    <Parts parts={b.parts} />
                  </p>
                ),
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
