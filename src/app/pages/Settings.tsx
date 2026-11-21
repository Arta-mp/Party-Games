import { useNavigate } from 'react-router';
import { useIdentity } from '@/core/identity/store';
import { useT } from '@/i18n';
import { Avatar, Button, Card, Screen, SectionTitle, Segmented, TextField, Toggle } from '@/ui/kit';
import { useSettings, type TransportKind } from '../settings';

export function SettingsPage() {
  const t = useT();
  const nav = useNavigate();
  const s = useSettings();
  const name = useIdentity((x) => x.name)!;
  return (
    <Screen title={t('settings.title')} onBack={() => nav(-1)}>
      <Card className="flex items-center gap-3">
        <Avatar name={name} size={48} />
        <b className="flex-1 text-lg">{name}</b>
        <Button variant="secondary" size="sm" onClick={() => nav('/name')} data-testid="change-name">
          {t('name.change')}
        </Button>
      </Card>

      <SectionTitle>{t('settings.look')}</SectionTitle>
      <Segmented
        label={t('settings.theme')}
        value={s.theme}
        onChange={(theme) => s.set({ theme })}
        options={[
          { value: 'dark', label: `🌙 ${t('settings.dark')}` },
          { value: 'light', label: `☀️ ${t('settings.light')}` },
        ]}
      />
      <Segmented
        label={t('settings.lang')}
        value={s.lang}
        onChange={(lang) => s.set({ lang })}
        options={[
          { value: 'fa', label: 'فارسی' },
          { value: 'en', label: 'English' },
        ]}
      />
      <Toggle label={`🔊 ${t('settings.sound')}`} checked={s.sound} onChange={(sound) => s.set({ sound })} />
      <Toggle label={`📳 ${t('settings.vibration')}`} checked={s.vibration} onChange={(vibration) => s.set({ vibration })} />

      <SectionTitle>{t('settings.network')}</SectionTitle>
      <p className="text-xs leading-6 text-muted">{t('settings.networkHint')}</p>
      <Segmented<TransportKind>
        value={s.transport}
        onChange={(transport) => s.set({ transport })}
        options={[
          { value: 'nostr', label: 'Nostr' },
          { value: 'mqtt', label: 'MQTT' },
          { value: 'torrent', label: 'Torrent' },
          { value: 'broadcast', label: t('settings.sameDevice') },
        ]}
      />
      <TextField label={t('settings.turnUrl')} value={s.turnUrl} onChange={(e) => s.set({ turnUrl: e.target.value.trim() })} placeholder="turn:example.com:3478" className="ltr text-base" />
      <div className="grid grid-cols-2 gap-2">
        <TextField label={t('settings.turnUser')} value={s.turnUser} onChange={(e) => s.set({ turnUser: e.target.value })} className="ltr text-base" />
        <TextField label={t('settings.turnPass')} type="password" value={s.turnPass} onChange={(e) => s.set({ turnPass: e.target.value })} className="ltr text-base" />
      </div>

      <SectionTitle>{t('settings.about')}</SectionTitle>
      <Card className="text-sm leading-7 text-muted">
        {t('settings.aboutText')}{' '}
        <a className="text-accent underline" href="https://github.com/Arta-mp/Party-Games" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <div className="ltr mt-1 text-xs">v{__APP_VERSION__}</div>
      </Card>
      <Button variant="ghost" onClick={() => s.set({ tutorialSeen: false })}>
        🎓 {t('settings.replayTutorial')}
      </Button>
    </Screen>
  );
}
