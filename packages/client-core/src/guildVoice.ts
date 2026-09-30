import { hasPermission, Permission } from '@diskort/shared';
import { useGuild, type GuildStore } from './guild';
import { permissionsInGuild } from './permissions';
import { useSession } from './session';

// Sunucu çubuğundaki ses/yayın rozeti: sunucuya geçmeden, orada seste biri var mı, yayın yapan var mı.

/** Sunucudaki ses etkinliği: yayın yapan varsa 'stream', yoksa seste biri varsa 'voice', yoksa null */
export type GuildVoiceActivity = 'stream' | 'voice' | null;

/**
 * Bir sunucunun ses etkinliği. Yalnızca kullanıcının görebildiği (VIEW_CHANNEL) o sunucunun ses
 * kanallarındaki kişiler sayılır; görünmeyen kanaldaki varlık sızmaz. Kullanıcının kendisi de sayılır.
 * Seçili olmayan sunucular da hesaplanır (ses durumları tüm ortak sunucular için tutulur).
 */
export function guildVoiceActivity(
  s: Pick<GuildStore, 'guilds' | 'voiceStates'>,
  guildId: string,
  selfId: string | undefined,
): GuildVoiceActivity {
  const g = s.guilds[guildId];
  if (!g || !selfId) return null;
  let activity: GuildVoiceActivity = null;
  // Kanal başına yetki bir kez hesaplanır
  const visible = new Map<string, boolean>();
  for (const v of Object.values(s.voiceStates)) {
    let ok = visible.get(v.channelId);
    if (ok === undefined) {
      ok = hasPermission(permissionsInGuild(g, selfId, v.channelId), Permission.VIEW_CHANNEL);
      visible.set(v.channelId, ok);
    }
    if (!ok) continue;
    if (v.streaming) return 'stream';
    activity = 'voice';
  }
  return activity;
}

/** Sunucunun ses etkinliği (metin döndüğü için yalnızca değişince yeniden çizer) */
export function useGuildVoiceActivity(guildId: string): GuildVoiceActivity {
  const selfId = useSession((s) => s.user?.id);
  return useGuild((s) => guildVoiceActivity(s, guildId, selfId));
}
