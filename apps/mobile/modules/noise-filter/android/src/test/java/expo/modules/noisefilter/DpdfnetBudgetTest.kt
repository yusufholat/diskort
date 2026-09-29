package expo.modules.noisefilter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** DPDFNet'in zaman bütçesi kararları (saha verisiyle). */
class DpdfnetBudgetTest {
  @Test
  fun warmUpNeedsClearHeadroom() {
    // SM7550: ısınma 4,00 ms geçmişti, canlıda 6,0–6,3 ms oldu → artık baştan reddedilir (genel yavaşlık),
    // ama canlı bütçeyi aşmadığı için kalıcı kaydedilmez (yalnızca bu açılış)
    val sm7550 = DpdfnetBudget.judgeWarmUp(avgMs = 4.0, spikeMs = 4.6, firstMs = 5.0)
    assertNotNull(sm7550)
    assertTrue(sm7550!!.systematic)
    assertFalse(DpdfnetBudget.rememberWarmUp(4.0))
    assertTrue(DpdfnetBudget.rememberWarmUp(5.5))
    // Güçlü telefon: rahat geçer
    assertNull(DpdfnetBudget.judgeWarmUp(avgMs = 2.0, spikeMs = 2.8, firstMs = 3.5))
    // Sınır: ısınma × 1,6 canlı bütçeye sığmalı
    assertNull(DpdfnetBudget.judgeWarmUp(avgMs = 3.1, spikeMs = 4.0, firstMs = 4.0))
    assertNotNull(DpdfnetBudget.judgeWarmUp(avgMs = 3.2, spikeMs = 4.0, firstMs = 4.0))
    assertTrue(DpdfnetBudget.WARMUP_BUDGET_MS * DpdfnetBudget.LIVE_FACTOR <= DpdfnetBudget.LIVE_BUDGET_MS + 1e-9)
  }

  @Test
  fun warmUpSpikesAreNotSystematic() {
    // Ortalama iyi ama ikinci en uzun kare 10 ms'ye yaklaşıyor ya da çok yavaş ilk yarı: ani takılma sayılır
    val spike = DpdfnetBudget.judgeWarmUp(avgMs = 2.0, spikeMs = 7.0, firstMs = 3.0)
    assertNotNull(spike)
    assertFalse(spike!!.systematic)
    val cold = DpdfnetBudget.judgeWarmUp(avgMs = 2.0, spikeMs = 3.0, firstMs = 9.0)
    assertNotNull(cold)
    assertFalse(cold!!.systematic)
  }

  @Test
  fun liveWindowBypassesOnAverageOrMisses() {
    // SM7550 canlı: ortalama 6,28 ms → tek pencerede genel yavaşlık
    val slow = DpdfnetBudget.judgeWindow(avgMs = 6.28, overHop = 0, frames = 200)
    assertNotNull(slow)
    assertTrue(slow!!.systematic)
    // 200 karede 2 kare 10 ms'yi aştı (%1): tolere edilir; 3 kare: yetişemedi (ani takılma)
    assertNull(DpdfnetBudget.judgeWindow(avgMs = 3.0, overHop = 2, frames = 200))
    val misses = DpdfnetBudget.judgeWindow(avgMs = 3.0, overHop = 3, frames = 200)
    assertNotNull(misses)
    assertFalse(misses!!.systematic)
    // İyi pencere ve boş pencere
    assertNull(DpdfnetBudget.judgeWindow(avgMs = 4.9, overHop = 0, frames = 200))
    assertNull(DpdfnetBudget.judgeWindow(avgMs = 0.0, overHop = 0, frames = 0))
    assertEquals(5.0, DpdfnetBudget.LIVE_BUDGET_MS, 0.0)
  }
}
