import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { canStart } from '@/core/lobby/lobby';
import { HOST_GRACE_MS } from '@/core/lobby/client';
import { META, type GameId } from '@/games/meta';
import { useNum, useT } from '@/i18n';
import { useTicker } from '@/lib/hooks';
import { Badge, Button, Card, Notice, PlayerChip, Screen, SectionTitle, Sheet, Toggle } from '@/ui/kit';
import { useOnline } from '../online';
import { GameConfigSheet, GamePicker } from '../components/GamePicker';
import { HowTo } from '../components/HowTo';
import { Qr } from '../components/Qr';
import { Awards, ResultsView, Scoreboard } from '../components/Results';
import { OnlineStage } from '../components/Stage';

export function inviteLink(code: string) {
  return `${location.origin}${location.pathname}#/join/${code}`;
}

export function JoinPage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const join = useOnline((s) => s.join);
  useEffect(() => {
    join(code.toUpperCase());
    nav(`/lobby/${code.toUpperCase()}`, { replace: true });
  }, [code, join, nav]);
  return null;
}

export function LobbyPage() {
  const t = useT();
  const num = useNum();
  const nav = useNavigate();
  const { code = '' } = useParams();
  const store = useOnline();
  const { state, module, role } = store;
  const [picker, setPicker] = useState(false);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [playerMenu, setPlayerMenu] = useState<string | null>(null);
  const [how, setHow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [since] = useState(() => Date.now());

  useEffect(() => {
    if (store.code !== code) void store.resume(code);
  }, [code, store]);

  const lobby = state?.lobby ?? null;
  const me = state?.playerId ?? null;
  const isHost = !!lobby && lobby.hostId === me;
  useTicker(state?.status === 'connecting' || state?.status === 'host-lost', 1000);

  const leave = () => {
    store.leave();
    nav('/');
  };

  if (
    state &&
    (state.status === 'kicked' ||
      state.status === 'locked' ||
      state.status === 'in-game' ||
      state.status === 'full')
  ) {
    return (
      <Screen title={t('app.name')}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span className="text-6xl">🚪</span>
          <h2 className="text-2xl font-black" data-testid="denied">
            {t(`lobby.denied.${state.status}`)}
          </h2>
          <Button size="lg" onClick={leave}>
            {t('common.home')}
          </Button>
        </div>
      </Screen>
    );
  }

  if (!state || state.status === 'connecting' || !lobby) {
    const slow = Date.now() - since > 12_000;
    return (
      <Screen title={t('lobby.connecting')} onBack={leave}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="border-border border-t-accent size-12 animate-spin rounded-full border-4" />
          <p className="ltr text-4xl font-black tracking-[0.3em]">{code}</p>
          <p className="text-muted">{t('lobby.connectingHint', { via: store.transportKind ?? '' })}</p>
          {slow && <Notice tone="info">{t('lobby.connectTroubleshoot')}</Notice>}
          <Button variant="secondary" onClick={() => nav('/settings')}>
            ⚙️ {t('settings.network')}
          </Button>
        </div>
      </Screen>
    );
  }

  const players = lobby.players.map((p) => ({ id: p.id, name: p.name }));
  const gameMeta = lobby.game ? META[lobby.game.id as GameId] : null;
  const family = lobby.status === 'playing' && gameMeta ? gameMeta.family : gameMeta?.family;
  const connected = lobby.players.filter((p) => p.connected).length;
  const startState = canStart(lobby);
  const meP = lobby.players.find((p) => p.id === me);

  const hostLost =
    state.status === 'host-lost' ? (
      <Notice tone="warn">
        {t('lobby.hostLost', {
          s: Math.max(0, Math.ceil((HOST_GRACE_MS - (Date.now() - (state.hostLostAt ?? Date.now()))) / 1000)),
        })}
      </Notice>
    ) : null;

  const hostName = lobby.players.find((p) => p.id === lobby.hostId)?.name ?? '';
  const notice = lobby.notice ? (
    <div data-testid="lobby-notice">
      <Notice tone="warn">{t(`lobby.notice.${lobby.notice}`, { name: hostName })}</Notice>
    </div>
  ) : null;

  // ------------------------------------------------------------------ in game
  if (lobby.status === 'playing') {
    return (
      <Screen
        family={family}
        title={gameMeta ? `${gameMeta.emoji} ${t(`game.${gameMeta.id}.name`)}` : ''}
        headerEnd={
          <>
            <Button variant="ghost" size="icon" onClick={() => setHow(true)} aria-label={t('how.title')}>
              ❓
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLeaving(true)}
              aria-label={t('lobby.leaveGame')}
              data-testid="leave-game"
            >
              🚪
            </Button>
          </>
        }
        footer={
          lobby.result && isHost ? (
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" onClick={() => store.lobbyAction({ type: 'next' })} data-testid="next-round">
                🔁 {t('results.next')}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => store.lobbyAction({ type: 'toLobby' })}
                data-testid="to-lobby"
              >
                {t('results.toLobby')}
              </Button>
            </div>
          ) : lobby.result ? (
            <Notice>{t('results.waitHost')}</Notice>
          ) : undefined
        }
      >
        {hostLost}
        {lobby.notice === 'hostHandedOver' && notice}
        {lobby.result ? (
          <ResultsView result={lobby.result} players={players} me={me} session={lobby} />
        ) : module && me ? (
          <OnlineStage
            module={module}
            view={state.view}
            me={me}
            isHost={isHost}
            players={players}
            dispatch={(a) => store.gameAction(a)}
            now={store.now}
            lastError={state.lastError}
          />
        ) : (
          <Notice>{t('common.loading')}</Notice>
        )}
        {isHost && !lobby.result && (
          <Button
            variant="ghost"
            onClick={() => store.lobbyAction({ type: 'toLobby' })}
            className="text-danger mt-4"
          >
            ⏹ {t('lobby.stopGame')}
          </Button>
        )}
        {gameMeta && <HowTo gameId={gameMeta.id} open={how} onClose={() => setHow(false)} />}
        <Sheet open={leaving} onClose={() => setLeaving(false)} title={t('lobby.leaveGame')}>
          <p className="text-muted">{isHost ? t('lobby.leaveHostHint') : t('lobby.leaveHint')}</p>
          <Button variant="danger" size="lg" onClick={leave} data-testid="confirm-leave">
            🚪 {t('lobby.leaveGame')}
          </Button>
          <Button variant="secondary" onClick={() => setLeaving(false)}>
            {t('common.cancel')}
          </Button>
        </Sheet>
      </Screen>
    );
  }

  // ------------------------------------------------------------------ lobby
  const share = async () => {
    const url = inviteLink(lobby.code);
    try {
      if (navigator.share)
        await navigator.share({
          title: t('app.name'),
          text: t('lobby.shareText', { code: lobby.code }),
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch {
      /* cancelled */
    }
  };

  const menuPlayer = lobby.players.find((p) => p.id === playerMenu);

  return (
    <Screen
      family={family}
      title={t('lobby.title')}
      onBack={leave}
      footer={
        isHost ? (
          <Button
            size="xl"
            block
            disabled={startState !== 'ok'}
            onClick={() => store.lobbyAction({ type: 'start' })}
            data-testid="start-game"
          >
            {startState === 'no-game'
              ? t('lobby.pickFirst')
              : startState === 'not-ready'
                ? t('lobby.waitReady')
                : `▶ ${t('lobby.start')}`}
          </Button>
        ) : (
          <Button
            size="xl"
            block
            variant={meP?.ready ? 'success' : 'primary'}
            onClick={() => store.lobbyAction({ type: 'ready', ready: !meP?.ready })}
            data-testid="ready"
          >
            {meP?.ready ? `✅ ${t('lobby.imReady')}` : t('lobby.ready')}
          </Button>
        )
      }
    >
      {hostLost}
      {notice}
      {state.lastError && <Notice tone="danger">{t(`err.${state.lastError}`)}</Notice>}
      <Card className="flex flex-col items-center gap-3 text-center">
        <span className="text-muted text-sm">{t('lobby.code')}</span>
        <span className="ltr text-accent text-5xl font-black tracking-[0.3em]" data-testid="lobby-code">
          {lobby.code}
        </span>
        <Qr text={inviteLink(lobby.code)} />
        <Button variant="secondary" onClick={share} data-testid="share">
          🔗 {copied ? t('lobby.copied') : t('lobby.share')}
        </Button>
      </Card>

      <SectionTitle>
        {t('lobby.players', { n: connected })}
        {lobby.locked && <Badge className="ms-2">🔒 {t('lobby.locked')}</Badge>}
      </SectionTitle>
      <div className="flex flex-col gap-2" data-testid="player-list">
        {lobby.players.map((p) => (
          <PlayerChip
            key={p.id}
            name={p.name}
            muted={!p.connected}
            testId={`player-${p.name}`}
            onClick={isHost && p.id !== me ? () => setPlayerMenu(p.id) : undefined}
            badges={
              <span className="flex items-center gap-1">
                {p.id === lobby.hostId && <Badge>👑 {t('lobby.host')}</Badge>}
                {p.id === me && <Badge>{t('lobby.you')}</Badge>}
                {!p.connected && <Badge>📴</Badge>}
              </span>
            }
            trailing={
              <span aria-label={p.ready ? 'ready' : 'not ready'}>
                {p.id === lobby.hostId || p.ready ? '✅' : '⏳'}
              </span>
            }
          />
        ))}
      </div>
      {isHost && (
        <Toggle
          label={t('lobby.lock')}
          hint={t('lobby.lockHint')}
          checked={lobby.locked}
          onChange={(v) => store.lobbyAction({ type: 'lock', locked: v })}
        />
      )}

      <SectionTitle>{t('lobby.game')}</SectionTitle>
      {gameMeta ? (
        <Card className="flex items-center gap-3" data-family={gameMeta.family}>
          <span className="text-3xl">{gameMeta.emoji}</span>
          <div className="flex-1">
            <b className="text-accent" data-testid="selected-game">
              {t(`game.${gameMeta.id}.name`)}
            </b>
            <p className="text-muted text-xs">
              {t('how.players', { min: gameMeta.minPlayers, max: gameMeta.maxPlayers })}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setHow(true)} aria-label={t('how.title')}>
            ❓
          </Button>
          {isHost && (
            <Button variant="secondary" size="sm" onClick={() => setConfigFor(gameMeta.id)}>
              ⚙️
            </Button>
          )}
        </Card>
      ) : (
        <Card className="text-muted text-center">
          {isHost ? t('lobby.pickHint') : t('lobby.hostPicking')}
        </Card>
      )}
      {isHost && (
        <Button variant="outline" onClick={() => setPicker(true)} data-testid="pick-game">
          🎮 {gameMeta ? t('lobby.changeGame') : t('lobby.pickGame')}
        </Button>
      )}

      {lobby.round > 0 && (
        <>
          <SectionTitle>{t('results.session', { n: num(lobby.round) })}</SectionTitle>
          <Scoreboard players={players} scores={lobby.scores} />
          <Awards session={lobby} players={players} />
        </>
      )}

      <Sheet open={picker} onClose={() => setPicker(false)} title={t('lobby.pickGame')}>
        <GamePicker
          playerCount={connected}
          mode="online"
          selected={lobby.game?.id}
          onPick={(id) => {
            setPicker(false);
            setConfigFor(id);
          }}
        />
      </Sheet>
      <GameConfigSheet
        gameId={configFor}
        initial={lobby.game?.id === configFor ? lobby.game?.config : undefined}
        playerCount={connected}
        players={lobby.players.filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name }))}
        mode="online"
        onClose={() => setConfigFor(null)}
        onConfirm={(gameId, config) => {
          store.lobbyAction({ type: 'select', gameId, config });
          setConfigFor(null);
        }}
      />
      <Sheet open={!!menuPlayer} onClose={() => setPlayerMenu(null)} title={menuPlayer?.name}>
        {menuPlayer && (
          <>
            <Button
              variant="secondary"
              disabled={!menuPlayer.connected}
              onClick={() => {
                store.lobbyAction({ type: 'transfer', id: menuPlayer.id });
                setPlayerMenu(null);
              }}
            >
              👑 {t('lobby.makeHost')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                store.lobbyAction({ type: 'kick', id: menuPlayer.id });
                setPlayerMenu(null);
              }}
              data-testid="kick"
            >
              🚫 {t('lobby.kick')}
            </Button>
          </>
        )}
      </Sheet>
      {gameMeta && <HowTo gameId={gameMeta.id} open={how} onClose={() => setHow(false)} />}
      {role === 'host' && <p className="text-muted text-center text-xs">{t('lobby.hostHint')}</p>}
    </Screen>
  );
}
