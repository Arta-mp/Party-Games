import { useEffect } from 'react';
import type { GameResult, Player, PlayerId } from '@/core/engine/types';
import { sessionAwards, type LobbyState } from '@/core/lobby/lobby';
import { useNum, useT, useTm } from '@/i18n';
import { play } from '@/lib/fx';
import { Avatar, Badge, Card, Confetti, SectionTitle } from '@/ui/kit';
import { cn } from '@/ui/cn';

export function Scoreboard({ players, scores }: { players: Player[]; scores: Record<PlayerId, number> }) {
  const num = useNum();
  const rows = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  return (
    <Card className="flex flex-col gap-2" data-testid="scoreboard">
      {rows.map((p, i) => (
        <div key={p.id} className="flex items-center gap-3">
          <span className="text-muted w-6 text-center text-sm">{num(i + 1)}</span>
          <Avatar name={p.name} size={32} />
          <span className="flex-1 truncate font-bold">{p.name}</span>
          <span className="text-accent font-black">{num(scores[p.id] ?? 0)}</span>
        </div>
      ))}
    </Card>
  );
}

export function Awards({
  session,
  players,
}: {
  session: Pick<LobbyState, 'scores' | 'stats'>;
  players: Player[];
}) {
  const t = useT();
  const num = useNum();
  const awards = sessionAwards({ ...(session as LobbyState), players: players as LobbyState['players'] });
  if (awards.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="awards">
      {awards.map((a) => {
        const p = players.find((x) => x.id === a.playerId);
        return (
          <Card key={a.key} className="flex flex-col items-center gap-1 p-3 text-center">
            <span className="text-muted text-xs">{t(a.key)}</span>
            {p && <Avatar name={p.name} size={36} />}
            <b className="truncate">{p?.name}</b>
            <span className="text-muted text-xs">{num(a.value)}</span>
          </Card>
        );
      })}
    </div>
  );
}

export function ResultsView({
  result,
  players,
  me,
  session,
}: {
  result: GameResult;
  players: Player[];
  me: PlayerId | null;
  session: Pick<LobbyState, 'scores' | 'stats' | 'round'>;
}) {
  const t = useT();
  const tm = useTm();
  const num = useNum();
  const won = me ? result.winners.includes(me) : result.winners.length > 0;
  useEffect(() => {
    play(won ? 'win' : 'lose');
  }, [won]);
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="animate-pop flex flex-col gap-4" data-testid="results">
      <Confetti active={won} />
      <Card className="flex flex-col items-center gap-2 py-6 text-center">
        <span className="text-5xl">{won ? '🏆' : '🎭'}</span>
        <h2 className="text-2xl font-black" data-testid="result-title">
          {tm(result.title)}
        </h2>
        {result.lines?.map((l, i) => (
          <p key={i} className="text-muted">
            {tm(l)}
          </p>
        ))}
        {result.secret && (
          <p className="mt-2">
            {t('results.secret')} <b className="text-accent">{result.secret}</b>
          </p>
        )}
        {me && (
          <Badge className={cn('mt-1 text-sm', won ? 'bg-success/20 text-text' : '')}>
            {won ? t('results.youWon') : t('results.youLost')}
          </Badge>
        )}
      </Card>
      {result.reveal && result.reveal.length > 0 && (
        <>
          <SectionTitle>{t('results.reveal')}</SectionTitle>
          <Card className="flex flex-col gap-2">
            {result.reveal.map((r) => (
              <div key={r.playerId + r.label} className="flex items-center gap-2">
                <Avatar name={name(r.playerId)} size={28} />
                <span className="flex-1 truncate">{name(r.playerId)}</span>
                <span className="text-sm font-bold">{r.label}</span>
                {result.scores[r.playerId] ? (
                  <Badge className="bg-accent/20 text-text">+{num(result.scores[r.playerId]!)}</Badge>
                ) : null}
              </div>
            ))}
          </Card>
        </>
      )}
      <SectionTitle>{t('results.session', { n: session.round })}</SectionTitle>
      <Scoreboard players={players} scores={session.scores} />
      <Awards session={session} players={players} />
    </div>
  );
}
