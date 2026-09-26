// Web'de ön plan servisi yok
export default {
  start: () => undefined,
  update: () => undefined,
  stop: () => undefined,
  addListener: () => ({ remove: () => undefined }),
};
