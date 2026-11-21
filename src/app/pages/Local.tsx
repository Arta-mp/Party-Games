import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { cleanName, validateName } from '@/core/identity/identity';
import { useIdentity } from '@/core/identity/store';
import { META, type GameId } from '@/games/meta';
import { useT } from '@/i18n';
import { Badge, Button, Card, Notice, PlayerChip, Screen, SectionTitle, Sheet, TextField } from '@/ui/kit';
import { useLocal } from '../local';
import { GameConfigSheet, GamePicker } from '../components/GamePicker';
import { HowTo } from '../components/HowTo';
import { ResultsView, Scoreboard } from '../components/Results';
import { LocalStage } from '../components/Stage';

/** Pass & Play setup: the host types everyone's name, picks a game, starts. No internet needed. */
export function LocalSetup() {
  const t = useT();
  const nav = useNavigate();
  const me = useIdentity((s) => s.name)!;
  const local = useLocal();
  const [draft, setDraft] = useState('');
  const [picker, setPicker] = useState(false);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void local.restore();
  }, [local]);
  useEffect(() => {
    if (local.restored && local.names.length === 0) local.setNames([me]);
  }, [local, local.restored, me]);
  useEffect(() => {
    if (local.restored && local.runner) nav('/local/play', { replace: true });
    // only on first restore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.restored]);

  const names = local.names;
  const nameErr = draft ? validateName(draft) : null;
  const dup = names.includes(cleanName(draft));
  const add = () => {
    if (validateName(draft) !== 'ok' || dup) return;
    local.setNames([...names, cleanName(draft)]);
    setDraft('');
  };
  const meta = local.gameId ? META[local.gameId as GameId] : null;

  return (
    <Screen
      title={`📱 ${t('home.local')}`}
      onBack={() => nav('/')}
      family={meta?.family}
      footer={
        <Button
          size="xl"
          block
          disabled={!local.gameId}
          data-testid="local-start"
          onClick={async () => {
            const err = await local.start();
            setError(err);
            if (!err) nav('/local/play');
          }}
        >
          {local.gameId ? `▶ ${t('lobby.start')}` : t('lobby.pickFirst')}
        </Button>
      }
    >
      <Notice>{t('local.intro')}</Notice>
      <SectionTitle>{t('local.players', { n: names.length })}</SectionTitle>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="flex-1">
          <TextField
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('local.addPlaceholder')}
            maxLength={20}
            data-testid="local-name"
            aria-label={t('local.addPlaceholder')}
            hint={dup ? t('local.dup') : nameErr && nameErr !== 'ok' ? t(`name.err.${nameErr}`) : undefined}
          />
        </div>
        <Button type="submit" size="lg" className="h-14" disabled={nameErr !== 'ok' || dup} data-testid="local-add">
          +
        </Button>
      </form>
      <div className="flex flex-col gap-2">
        {names.map((n, i) => (
          <PlayerChip
            key={n}
            name={n}
            badges={i === 0 ? <Badge>👑 {t('lobby.host')}</Badge> : undefined}
            trailing={
              i > 0 ? (
                <Button variant="ghost" size="icon" aria-label={t('common.remove')} onClick={() => local.setNames(names.filter((x) => x !== n))}>
                  ✕
                </Button>
              ) : undefined
            }
          />
        ))}
      </div>

      <SectionTitle>{t('lobby.game')}</SectionTitle>
      {meta ? (
        <Card className="flex items-center gap-3" data-family={meta.family}>
          <span className="text-3xl">{meta.emoji}</span>
          <b className="flex-1 text-accent" data-testid="selected-game">{t(`game.${meta.id}.name`)}</b>
          <Button variant="secondary" size="sm" onClick={() => setConfigFor(meta.id)}>
            ⚙️
          </Button>
        </Card>
      ) : null}
      <Button variant="outline" onClick={() => setPicker(true)} data-testid="pick-game">
        🎮 {meta ? t('lobby.changeGame') : t('lobby.pickGame')}
      </Button>
      {error && <Notice tone="danger">{t(error)}</Notice>}
      {local.session.round > 0 && (
        <>
          <SectionTitle>{t('results.session', { n: local.session.round })}</SectionTitle>
          <Scoreboard players={local.session.players} scores={local.session.scores} />
        </>
      )}

      <Sheet open={picker} onClose={() => setPicker(false)} title={t('lobby.pickGame')}>
        <GamePicker
          playerCount={names.length}
          mode="local"
          selected={local.gameId}
          onPick={(id) => {
            setPicker(false);
            setConfigFor(id);
          }}
        />
      </Sheet>
      <GameConfigSheet
        gameId={configFor}
        initial={local.gameId === configFor ? local.config : undefined}
        playerCount={names.length}
        mode="local"
        onClose={() => setConfigFor(null)}
        onConfirm={(id, cfg) => {
          void local.select(id, cfg);
          setConfigFor(null);
        }}
      />
    </Screen>
  );
}

export function LocalPlay() {
  const t = useT();
  const nav = useNavigate();
  const local = useLocal();
  useLocal((s) => s.rev);
  const [how, setHow] = useState(false);
  const [quit, setQuit] = useState(false);
  useEffect(() => {
    void local.restore();
  }, [local]);
  useEffect(() => {
    if (local.restored && !local.runner) nav('/local', { replace: true });
  }, [local.restored, local.runner, nav]);
  if (!local.runner || !local.module) return null;
  const meta = local.module.meta;
  const result = local.session.result;
  return (
    <Screen
      family={meta.family}
      title={`${meta.emoji} ${t(`game.${meta.id}.name`)}`}
      headerEnd={
        <>
          <Button variant="ghost" size="icon" onClick={() => setHow(true)} aria-label={t('how.title')}>
            ❓
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setQuit(true)} aria-label={t('lobby.stopGame')}>
            ✕
          </Button>
        </>
      }
      footer={
        result ? (
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" onClick={() => void local.next()} data-testid="next-round">
              🔁 {t('results.next')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                local.toSetup();
                nav('/local');
              }}
              data-testid="to-lobby"
            >
              {t('results.toSetup')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {result ? (
        <ResultsView result={result} players={local.session.players} me={null} session={local.session} />
      ) : (
        <LocalStage key={local.session.round} />
      )}
      <HowTo gameId={meta.id} open={how} onClose={() => setHow(false)} />
      <Sheet open={quit} onClose={() => setQuit(false)} title={t('lobby.stopGame')}>
        <p className="text-muted">{t('local.quitConfirm')}</p>
        <Button
          variant="danger"
          onClick={() => {
            local.toSetup();
            nav('/local');
          }}
        >
          {t('lobby.stopGame')}
        </Button>
      </Sheet>
    </Screen>
  );
}
