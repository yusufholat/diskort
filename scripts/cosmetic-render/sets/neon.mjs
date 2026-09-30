// Neon Yağmur'un çizim aracı ayarları (render.mjs loadSetConfig).
export default {
  pieces: {
    // Döngü biçiminin kartı standart tuvale göre kuruldu (alt kenara bağlı bir şey yok): yerleşim, tuvalin kendisi
    card: { layoutH: 450 },
  },
  // Tabelaların ve tüplerin titremesi setin kimliği ve BİLEREK ani (tüp bir an söner): kesintisizlik denetimi
  // onu kesme sayar. Denetim bu yüzden titreme kapalıyken çizilen karelerde de yapılır; karar ona göredir.
  continuity: { shaderOptions: { flicker: false }, note: 'titreme kapalı' },
};
