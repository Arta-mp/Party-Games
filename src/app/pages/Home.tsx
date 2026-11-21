import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useIdentity } from '@/core/identity/store';
import { CODE_RE, normalizeCode } from '@/core/net/code';
import { FAMILIES, gamesOf } from '@/games/registry';
import { useNum, useT } from '@/i18n';
import { Avatar, Button, Card, Screen, SectionTitle, Sheet, TextField } from '@/ui/kit';
import { GameCard } from '../components/GamePicker';
import { HowTo } from '../components/HowTo';

export function Home() {
  const t = useT();
  const num = useNum();
  const nav = useNavigate();
  const name = useIdentity((s) => s.name)!;
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [how, setHow] = useState<string | null>(null);
  const valid = CODE_RE.test(code);

  return (
    <Screen
      title={
        <span className="flex items-center gap-2">
          <span aria-hidden>🎉</span> {t('app.name')}
        </span>
      }
      headerEnd={
        <Link
          to="/settings"
          aria-label={t('settings.title')}
          className="bg-surface-2 flex items-center gap-2 rounded-full py-1 ps-1 pe-3"
          data-testid="me-chip"
        >
          <Avatar name={name} size={36} />
          <span className="max-w-24 truncate text-sm font-bold">{name}</span>
        </Link>
      }
    >
      <Card className="border-brand/30 from-brand/10 to-surface flex flex-col gap-3 bg-gradient-to-b p-5">
        <h2 className="text-2xl leading-snug font-black">{t('home.hello', { name })}</h2>
        <p className="text-muted text-sm leading-7">{t('home.tagline')}</p>
        <Button
          size="xl"
          block
          disabled={busy}
          data-testid="create-lobby"
          onClick={async () => {
            setBusy(true);
            const { useOnline } = await import('../online');
            const c = await useOnline.getState().createLobby();
            setBusy(false);
            nav(`/lobby/${c}`);
          }}
        >
          🌐 {t('home.create')}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => setJoinOpen(true)} data-testid="open-join">
            🔑 {t('home.join')}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => nav('/local')} data-testid="pass-and-play">
            📱 {t('home.local')}
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Link to="/custom" className="border-border bg-surface rounded-2xl border p-4 text-sm font-bold">
          ✏️ {t('home.custom')}
        </Link>
        <Link to="/settings" className="border-border bg-surface rounded-2xl border p-4 text-sm font-bold">
          ⚙️ {t('settings.title')}
        </Link>
      </div>

      <SectionTitle>
        {t('home.allGames', { n: num(FAMILIES.reduce((s, f) => s + gamesOf(f.id).length, 0)) })}
      </SectionTitle>
      {FAMILIES.map((f) => (
        <section key={f.id} data-family={f.id} className="flex flex-col gap-2">
          <h3 className="text-accent flex items-center gap-2 text-lg font-black">
            <span>{f.emoji}</span> {t(`family.${f.id}`)}
          </h3>
          <p className="text-muted -mt-1 text-xs">{t(`family.${f.id}.desc`)}</p>
          {gamesOf(f.id).map((g) => (
            <GameCard key={g.id} meta={g} onClick={() => setHow(g.id)} />
          ))}
        </section>
      ))}
      <p className="text-muted py-4 text-center text-xs">{t('home.footer')}</p>

      <Sheet open={joinOpen} onClose={() => setJoinOpen(false)} title={t('home.join')}>
        <TextField
          label={t('home.codeLabel')}
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={4}
          className="ltr text-center text-3xl tracking-[0.4em]"
          placeholder="K7QM"
          data-testid="join-code"
        />
        <Button size="lg" disabled={!valid} onClick={() => nav(`/join/${code}`)} data-testid="join-submit">
          {t('home.joinGo')}
        </Button>
      </Sheet>
      {how && <HowTo gameId={how} open onClose={() => setHow(null)} />}
    </Screen>
  );
}
