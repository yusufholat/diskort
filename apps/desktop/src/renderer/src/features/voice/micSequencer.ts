/**
 * Görüşmedeki mikrofon zincirinin kurulum sırası. Yayınlama, yeniden yayınlama (gürültü engelleyici düştü,
 * ayar değişti, model yeniden denendi) ve izin değişince kaldırma tek sırada, birbiri ardına çalışır.
 *
 * Neden: sırasız iki yeniden kurulum üst üste binince ikisi de mikrofon yayınlıyordu. Biri kimsenin elinde
 * kalmıyor, susturmaya uymadan (gürültü engellemesiz) ses göndermeyi sürdürüyor ve seviye göstergesini
 * (konuşma halkası) ikinci bir kapıdan besliyordu. Tarayıcı da ikinci yakalamada istenen standart gürültü
 * engellemesini açmıyor (canlı yakalamanın ayarını paylaşıyor).
 */
export class MicSequencer<P> {
  /** Odada yayınlanan mikrofonun işlemcisi; yalnızca ondan gelen seviye/hata/yeniden kurulum dikkate alınır */
  current: P | null = null;
  private queue: Promise<void> = Promise.resolve();
  private rebuildQueued: Promise<void> | null = null;
  private deferred = false;

  /** İşi sıraya ekler; öncekiler (hata verse de) bitmeden başlamaz. */
  run(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Yeniden kurulum ister. Sırada henüz başlamamış bir yeniden kurulum varsa ona katılır (ayarlar o başlarken
   * okunur). Başladığında bağlı değilse (ör. yeniden bağlanıyor) iptal edilmez, bağlantı gelince yapılır.
   */
  requestRebuild(canRun: () => boolean, rebuild: () => Promise<void>): Promise<void> {
    if (this.rebuildQueued) return this.rebuildQueued;
    const p = this.run(async () => {
      this.rebuildQueued = null;
      if (!canRun()) {
        this.deferred = true;
        return;
      }
      this.deferred = false;
      await rebuild();
    });
    this.rebuildQueued = p;
    return p;
  }

  /** Bağlantı geri geldi: ertelenmiş yeniden kurulum varsa true (bir kez) */
  takeDeferred(): boolean {
    const d = this.deferred;
    this.deferred = false;
    return d;
  }

  /** Mikrofon güncel ayarlarla yeni baştan kuruluyor ya da oda kapandı: ertelenen iş gereksiz */
  clearDeferred(): void {
    this.deferred = false;
  }

  /**
   * `p` odada yayınlanan zincirin işlemcisi mi. Seviye, düşüş ve yeniden kurulum geri çağırmaları yalnızca
   * öyleyse dikkate alınır: eski zincirlerin geç gelen olayları ve henüz kurulan zincirinkiler yok sayılır.
   */
  isCurrent(p: P): boolean {
    return p !== null && this.current === p;
  }
}
