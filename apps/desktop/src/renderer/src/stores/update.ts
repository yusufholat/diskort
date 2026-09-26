import { create } from 'zustand';
import type { UpdateState } from '../../../shared/bridge';

interface UpdateStore {
  /** Ana süreçteki güncelleyicinin durumu */
  state: UpdateState;
  /** Sunucu bu istemciyi eski bulup reddettiyse kurulması gereken sürüm */
  required: string | null;
}

export const useUpdate = create<UpdateStore>()(() => ({ state: { kind: 'idle' }, required: null }));
