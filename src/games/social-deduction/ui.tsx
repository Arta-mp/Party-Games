import { useMemo, useState, type ComponentType } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import type { AbilityRole } from '@/custom/schemas';
import { useCustom } from '@/custom/store';
import { useNum, useT, useTm } from '@/i18n';
import { play } from '@/lib/fx';
import { cn } from '@/ui/cn';
import {
  Badge,
  Button,
  Card,
  HoldReveal,
  Notice,
  PlayerChip,
  PlayerPicker,
  SectionTitle,
  Segmented,
  Stepper,
  Timer,
  Toggle,
} from '@/ui/kit';
import { SKIP, type MafiaAction, type MafiaConfig, type MafiaKind, type MafiaView } from './core';
import {
  balance,
  defaultComposition,
  rolePool,
  SCENARIOS,
  scenarioComposition,
  type Composition,
} from './roles';

// ------------------------------------------------------------------ setup

export function BalanceMeter({ comp }: { comp: Composition }) {
  const t = useT();
  const num = useNum();
  const b = balance(comp);
  const pct = Math.max(0, Math.min(100, 50 + b * 4));
  return (
    <div className="flex flex-col gap-1" data-testid="balance">
      <div className="text-muted flex justify-between text-xs">
        <span>🔫 {t('mafia.balance.mafia')}</span>
        <b className={cn(Math.abs(b) <= 3 ? 'text-success' : 'text-brand')}>
          {t('mafia.balance.value', { n: num(b) })} ·{' '}
          {Math.abs(b) <= 3
            ? t('mafia.balance.ok')
            : b > 0
              ? t('mafia.balance.town')
              : t('mafia.balance.mafiaSide')}
        </b>
        <span>{t('mafia.balance.town')} 🙂</span>
      </div>
      <div className="from-success/60 via-surface-2 to-danger/60 relative h-3 rounded-full bg-gradient-to-l">
        <span
          className="bg-accent absolute top-1/2 size-5 -translate-y-1/2 rounded-full border-2 border-white transition-all"
          style={{ insetInlineEnd: `calc(${pct}% - 10px)` }}
        />
      </div>
    </div>
  );
}

export function makeMafiaSetup(kind: MafiaKind): ComponentType<SetupProps<MafiaConfig>> {
  return function MafiaSetup({ config, onChange, playerCount }: SetupProps<MafiaConfig>) {
    const t = useT();
    const num = useNum();
    const [advanced, setAdvanced] = useState(false);
    const custom = useCustom((s) => s.abilityRoles);
    const myScenarios = useCustom((s) => s.scenarios);
    const saveScenario = useCustom((s) => s.saveScenario);
    const removeScenario = useCustom((s) => s.removeScenario);
    const [scenarioName, setScenarioName] = useState('');
    const packKind = kind === 'werewolf' ? 'werewolf' : kind === 'onenight' ? 'onenight' : 'mafia';
    const seats = Math.max(1, kind === 'moderated' ? playerCount - 1 : playerCount);
    const pool = useMemo(() => {
      const base = rolePool(packKind);
      return [...base, ...custom.filter((c) => !base.some((b) => b.id === c.id))];
    }, [packKind, custom]);
    const comp: Composition = config.composition ?? defaultComposition(packKind, seats);
    const countOf = (id: string) => comp.find((c) => c.role.id === id)?.n ?? 0;
    const setCount = (role: AbilityRole, n: number) => {
      const rest = comp.filter((c) => c.role.id !== role.id);
      onChange({ ...config, composition: n > 0 ? [...rest, { role, n }] : rest });
    };
    const assigned = comp.reduce((s, c) => s + c.n, 0);
    const night = pool.filter((r) => r.night.length > 0 && countOf(r.id) > 0);
    return (
      <div className="flex flex-col gap-3">
        {kind === 'moderated' && <Notice>{t('mafia.cfg.moderatorHint')}</Notice>}
        {packKind === 'mafia' && (
          <div className="flex flex-col gap-1.5" data-testid="scenarios">
            <span className="text-muted text-sm font-bold">{t('mafia.cfg.scenario')}</span>
            <div className="flex flex-wrap gap-2">
              {SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  data-testid={`scenario-${sc.id}`}
                  onClick={() => onChange({ ...config, composition: scenarioComposition(sc, seats) })}
                  className="border-border h-10 rounded-full border px-3 text-sm font-bold"
                >
                  {sc.nameFa}
                </button>
              ))}
              {myScenarios.map((sc) => (
                <span key={sc.id} className="border-accent flex h-10 items-center rounded-full border ps-3">
                  <button
                    type="button"
                    className="text-sm font-bold"
                    onClick={() =>
                      onChange({
                        ...config,
                        composition: scenarioComposition(
                          { roles: sc.roles.map((x) => [x.role, x.n]) },
                          seats,
                        ),
                      })
                    }
                  >
                    ✏️ {sc.nameFa}
                  </button>
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    className="text-muted px-2"
                    onClick={() => removeScenario(sc.id)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <span className="text-muted text-xs">{t('mafia.cfg.scenarioHint')}</span>
          </div>
        )}
        <Toggle
          label={t('mafia.cfg.autoComp')}
          hint={t('mafia.cfg.autoCompHint', { n: seats })}
          checked={config.composition == null}
          onChange={(auto) =>
            onChange({ ...config, composition: auto ? null : defaultComposition(packKind, seats) })
          }
        />
        <BalanceMeter comp={comp} />
        {config.composition != null && (
          <div className="flex flex-col gap-2" data-testid="composition">
            {pool.map((r) => (
              <Stepper
                key={r.id}
                label={`${r.emoji} ${r.nameFa}`}
                value={countOf(r.id)}
                min={0}
                max={12}
                onChange={(n) => setCount(r, n)}
              />
            ))}
            <p className="text-muted text-xs">
              {t('mafia.cfg.assigned', { n: num(assigned), seats: num(seats) })}
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const nameFa = scenarioName.trim();
                if (!nameFa) return;
                // plain citizens fill the remaining seats automatically, so they aren't stored
                const roles = comp.filter(
                  (c) => c.n > 0 && !(c.role.id === 'citizen' || c.role.id === 'villager'),
                );
                saveScenario({ id: `sc-${Date.now().toString(36)}`, nameFa, roles });
                setScenarioName('');
              }}
            >
              <input
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder={t('mafia.cfg.scenarioName')}
                aria-label={t('mafia.cfg.scenarioName')}
                maxLength={40}
                className="border-border bg-surface-2 focus:border-accent h-12 min-w-0 flex-1 rounded-2xl border px-3 outline-none"
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={!scenarioName.trim()}
                data-testid="save-scenario"
              >
                💾 {t('mafia.cfg.saveScenario')}
              </Button>
            </form>
          </div>
        )}
        {config.composition == null && (
          <div className="flex flex-wrap gap-1.5">
            {comp.map((c) => (
              <Badge key={c.role.id} className="text-sm">
                {c.role.emoji} {c.role.nameFa} ×{num(c.n)}
              </Badge>
            ))}
          </div>
        )}
        {kind !== 'moderated' && (
          <Stepper
            label={t('mafia.cfg.day')}
            value={config.daySeconds}
            min={0}
            max={1200}
            step={30}
            format={(v) => (v ? t('common.seconds', { n: num(v) }) : t('common.noTimer'))}
            onChange={(daySeconds) => onChange({ ...config, daySeconds })}
          />
        )}
        {kind !== 'moderated' && (
          <>
            <Toggle
              label={t('mafia.cfg.reveal')}
              checked={config.revealOnDeath}
              onChange={(revealOnDeath) => onChange({ ...config, revealOnDeath })}
            />
            {kind !== 'onenight' && (
              <>
                <Toggle
                  label={t('mafia.cfg.defense')}
                  hint={t('mafia.cfg.defenseHint')}
                  checked={config.defense}
                  onChange={(defense) => onChange({ ...config, defense })}
                />
                {config.defense && (
                  <Stepper
                    label={t('mafia.cfg.defenseTime')}
                    value={config.defenseSeconds}
                    min={10}
                    max={300}
                    step={5}
                    format={(v) => t('common.seconds', { n: num(v) })}
                    onChange={(defenseSeconds) => onChange({ ...config, defenseSeconds })}
                  />
                )}
              </>
            )}
            <Segmented
              label={t('hw.cfg.voteMode')}
              value={config.voteMode}
              onChange={(voteMode) => onChange({ ...config, voteMode })}
              options={[
                { value: 'secret', label: t('hw.cfg.voteSecret') },
                { value: 'host', label: t('hw.cfg.voteHost') },
              ]}
            />
            <Button variant="ghost" onClick={() => setAdvanced(!advanced)}>
              ⚙️ {t('mafia.cfg.priorities')} {advanced ? '▴' : '▾'}
            </Button>
            {advanced &&
              night.map((r) => (
                <Stepper
                  key={r.id}
                  label={`${r.emoji} ${r.nameFa}`}
                  value={config.priorities[r.id] ?? r.night[0]!.priority ?? 0}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(v) => onChange({ ...config, priorities: { ...config.priorities, [r.id]: v } })}
                />
              ))}
          </>
        )}
      </div>
    );
  };
}

// ------------------------------------------------------------------ play

function RoleCard({ view }: { view: MafiaView }) {
  const t = useT();
  const me = view.me!;
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  return (
    <div className="flex flex-col items-center gap-2 text-center" data-testid="role-card">
      <span className="text-5xl">{me.role.emoji}</span>
      <span
        className={cn('text-2xl font-black', me.role.team === 'mafia' && 'text-danger')}
        data-testid="role-name"
      >
        {me.role.nameFa}
      </span>
      <Badge>{t(`mafia.team.${me.role.team}`)}</Badge>
      <p className="text-muted max-w-xs text-xs leading-6">{me.role.descriptionFa}</p>
      {me.teammates.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          {me.teammates.map((m) => (
            <Badge key={m.id} className="bg-danger/20 text-text">
              {name(m.id)}: {m.roleName}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function Notes({ view }: { view: MafiaView }) {
  const t = useT();
  const tm = useTm();
  if (!view.me?.notes.length) return null;
  return (
    <Card className="flex flex-col gap-1">
      <b className="text-sm">{t('mafia.notes')}</b>
      {view.me.notes.map((n, i) => (
        <p key={i} className="text-sm" data-testid="note">
          {t('mafia.nightN', { n: n.p?.night ?? '' })}: {tm(n)}
        </p>
      ))}
    </Card>
  );
}

export function MafiaPlay({ view, dispatch, me, isHost, now, mode }: PlayProps<MafiaView, MafiaAction>) {
  const t = useT();
  const num = useNum();
  const [pick, setPick] = useState<string | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [abilityIdx, setAbilityIdx] = useState<number>(view.me?.abilities[0]?.index ?? -1);
  const name = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? '';
  const alive = view.players.filter((p) => view.alive.includes(p.id));
  const amAlive = !!me && view.alive.includes(me);
  const amModerator = !!me && me === view.moderator;

  const header = (
    <div className="flex flex-wrap gap-2">
      {view.night > 0 && (
        <Badge>
          {view.phase === 'night'
            ? `🌙 ${t('mafia.nightN', { n: view.night })}`
            : `☀️ ${t('mafia.dayN', { n: view.night })}`}
        </Badge>
      )}
      <Badge>{t('mafia.aliveN', { n: view.alive.length })}</Badge>
      {view.me && !amAlive && view.phase !== 'reveal' && (
        <Badge className="bg-danger/20 text-text">💀 {t('mafia.youDead')}</Badge>
      )}
    </div>
  );

  // ---------------------------------------------------- reveal
  if (view.phase === 'reveal') {
    if (amModerator)
      return <Notice>{t('mafia.youModerate', { n: view.acked.length, total: view.seats.length })}</Notice>;
    if (!view.me)
      return <Notice>{t('hw.waitingOthers', { n: view.acked.length, total: view.seats.length })}</Notice>;
    const acked = view.acked.includes(me!);
    return (
      <div className="flex flex-col gap-4">
        <HoldReveal>
          <RoleCard view={view} />
        </HoldReveal>
        {acked ? (
          <Notice>{t('hw.waitingOthers', { n: view.acked.length, total: view.seats.length })}</Notice>
        ) : (
          <Button size="lg" onClick={() => dispatch({ type: 'ack' })} data-testid="ack">
            {mode === 'local' ? t('hw.seenPass') : t('hw.seen')}
          </Button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------- moderated: the moderator's screen
  if (view.phase === 'moderating') {
    if (view.script) {
      return (
        <div className="flex flex-col gap-3" data-testid="script">
          <Notice>{t('mafia.mod.intro')}</Notice>
          <SectionTitle>{t('mafia.mod.night')}</SectionTitle>
          <ol className="flex flex-col gap-2">
            {view.script.order.map((step, i) => (
              <li key={i} className="bg-surface-2 flex items-center gap-2 rounded-2xl p-3 text-sm">
                <span className="bg-accent text-accent-ink grid size-7 place-items-center rounded-full font-black">
                  {num(i + 1)}
                </span>
                <span className="flex-1">
                  {step.emoji}{' '}
                  <b>
                    {['citizens', 'mafia', 'neutral'].includes(step.roleName)
                      ? t(`mafia.team.${step.roleName}`)
                      : step.roleName}
                  </b>{' '}
                  — {t(`mafia.action.${step.action}`)}
                  <span className="text-muted block text-xs">{step.players.map(name).join('، ')}</span>
                </span>
              </li>
            ))}
          </ol>
          <SectionTitle>{t('mafia.mod.players')}</SectionTitle>
          {view.script.roles.map((r) => (
            <PlayerChip
              key={r.id}
              name={name(r.id)}
              muted={!view.alive.includes(r.id)}
              onClick={() => dispatch({ type: 'modToggle', target: r.id })}
              badges={
                <Badge className={r.team === 'mafia' ? 'bg-danger/20 text-text' : ''}>
                  {r.emoji} {r.roleName}
                </Badge>
              }
              trailing={view.alive.includes(r.id) ? '❤️' : '💀'}
            />
          ))}
          <SectionTitle>{t('mafia.mod.end')}</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            {(['citizens', 'mafia', 'neutral'] as const).map((team) => (
              <Button
                key={team}
                variant="secondary"
                size="sm"
                onClick={() => dispatch({ type: 'modEnd', team })}
                data-testid={`mod-end-${team}`}
              >
                {t(`mafia.team.${team}`)}
              </Button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Notice>{t('mafia.mod.playerHint', { name: name(view.moderator) })}</Notice>
        {view.me && (
          <HoldReveal className="h-48" label={t('hw.peekRole')}>
            <RoleCard view={view} />
          </HoldReveal>
        )}
        {alive.map((p) => (
          <PlayerChip key={p.id} name={p.name} />
        ))}
      </div>
    );
  }

  // ---------------------------------------------------- night
  const lynchInfo = view.lastLynch && (
    <Notice tone="warn">
      {view.lastLynch.id
        ? t('mafia.lynched', { name: name(view.lastLynch.id) }) +
          (view.lastLynch.role ? ` (${view.lastLynch.role})` : '')
        : t('mafia.noLynch')}
    </Notice>
  );

  if (view.phase === 'night') {
    if (!view.me || !amAlive) {
      return (
        <div className="flex flex-col gap-3">
          {header}
          {lynchInfo}
          <Card className="py-8 text-center text-xl">🌙 {t('mafia.nightFalls')}</Card>
          <Notice>{t('mafia.nightProgress', { n: view.nightDone.length, total: view.alive.length })}</Notice>
        </div>
      );
    }
    if (view.me.choice) {
      return (
        <div className="flex flex-col gap-3">
          {header}
          <Card className="py-8 text-center text-xl">😴 {t('mafia.sleeping')}</Card>
          <Notice>{t('mafia.nightProgress', { n: view.nightDone.length, total: view.alive.length })}</Notice>
          <Notes view={view} />
        </div>
      );
    }
    const abilities = view.me.abilities;
    const current = abilities.find((a) => a.index === abilityIdx) ?? abilities[0];
    const mates = view.me.teammates.map((m) => m.id);
    const targets = current
      ? current.target === 'dead'
        ? view.players.filter((p) => view.seats.includes(p.id) && !view.alive.includes(p.id))
        : alive.filter((p) =>
            current.target === 'self'
              ? p.id === me
              : current.target === 'ownTeam'
                ? p.id === me || mates.includes(p.id)
                : current.target === 'teammate'
                  ? mates.includes(p.id)
                  : current.target === 'other'
                    ? p.id !== me
                    : true,
          )
      : [];
    const needed = current?.targets ?? 1;
    const leaderNote =
      view.me.role.team === 'mafia' && view.me.leader && view.me.leader !== me ? (
        <Notice tone="warn">🎩 {t('mafia.leaderDecides', { name: name(view.me.leader) })}</Notice>
      ) : null;
    return (
      <div className="flex flex-col gap-3">
        {header}
        {lynchInfo}
        <HoldReveal className="h-40" label={t('hw.peekRole')}>
          <RoleCard view={view} />
        </HoldReveal>
        <Notes view={view} />
        {leaderNote}
        {current ? (
          <>
            {abilities.length > 1 && (
              <Segmented
                value={String(current.index)}
                onChange={(v) => setAbilityIdx(Number(v))}
                options={abilities.map((a) => ({
                  value: String(a.index),
                  label: t(`mafia.action.${a.action}`),
                }))}
              />
            )}
            <h2 className="text-xl font-black">
              {t(`mafia.actionPrompt.${current.action}`)}
              {current.usesLeft != null && (
                <Badge className="ms-2">{t('mafia.usesLeft', { n: current.usesLeft })}</Badge>
              )}
            </h2>
            {view.me.teamPicks.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {view.me.teamPicks.map((tp) => (
                  <Badge key={tp.id} className="bg-danger/15 text-text">
                    {name(tp.id)} → {tp.target ? name(tp.target) : '…'}
                  </Badge>
                ))}
              </div>
            )}
            {needed > 1 ? (
              <div className="flex flex-col gap-2" data-testid="multi-pick">
                <span className="text-muted text-sm">{t('mafia.pickN', { n: needed })}</span>
                {targets.map((p) => (
                  <PlayerChip
                    key={p.id}
                    name={p.name}
                    testId={`pick-${p.name}`}
                    selected={multi.includes(p.id)}
                    onClick={() =>
                      setMulti(
                        multi.includes(p.id)
                          ? multi.filter((x) => x !== p.id)
                          : multi.length < needed
                            ? [...multi, p.id]
                            : multi,
                      )
                    }
                  />
                ))}
              </div>
            ) : (
              <PlayerPicker players={targets} value={pick} onChange={setPick} />
            )}
            <Button
              size="lg"
              disabled={needed > 1 ? multi.length !== needed : !pick}
              onClick={() => {
                if (needed > 1)
                  dispatch({ type: 'night', ability: current.index, target: multi[0]!, targets: multi });
                else if (pick) dispatch({ type: 'night', ability: current.index, target: pick });
                else return;
                setPick(null);
                setMulti([]);
                play('tap');
              }}
              data-testid="night-act"
            >
              {t('common.confirm')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => dispatch({ type: 'night', ability: -1, target: null })}
              data-testid="night-skip"
            >
              {t('mafia.skipNight')}
            </Button>
          </>
        ) : (
          <>
            {leaderNote}
            <Card className="text-muted text-center">{t('mafia.noAbility')}</Card>
            <Button
              size="lg"
              onClick={() => dispatch({ type: 'night', ability: -1, target: null })}
              data-testid="night-skip"
            >
              😴 {t('mafia.sleep')}
            </Button>
          </>
        )}
      </div>
    );
  }

  // ---------------------------------------------------- dawn / day / vote / revenge
  const dawn = view.dawn && (
    <Card className="flex flex-col gap-2" data-testid="dawn">
      <b>☀️ {t('mafia.dawnTitle', { n: view.night })}</b>
      {view.dawn.killed.length === 0 && <p className="text-success">{t('mafia.nobodyDied')}</p>}
      {view.dawn.killed.map((k) => (
        <p key={k.id} className="text-danger">
          💀 {name(k.id)} {k.role && `(${k.role})`}
        </p>
      ))}
      {view.dawn.saved > 0 && <p className="text-muted text-sm">{t('mafia.someoneSaved')}</p>}
      {view.dawn.revealed.map((r) => (
        <p key={r.id} className="text-sm">
          🔦 {t('mafia.revealed', { name: name(r.id), role: r.role })}
        </p>
      ))}
      {view.dawn.revived.map((id) => (
        <p key={id} className="text-success text-sm">
          ✨ {t('mafia.revivedPublic', { name: name(id) })}
        </p>
      ))}
      {view.dawn.silenced.map((id) => (
        <p key={id} className="text-sm">
          🤐 {t('mafia.silenced', { name: name(id) })}
        </p>
      ))}
    </Card>
  );

  if (view.phase === 'dawn') {
    return (
      <div className="flex flex-col gap-3">
        {header}
        {dawn}
        <Notes view={view} />
        {isHost ? (
          <Button size="lg" onClick={() => dispatch({ type: 'continue' })} data-testid="continue">
            {t('mafia.toDay')}
          </Button>
        ) : (
          <Notice>{t('mafia.waitHost')}</Notice>
        )}
      </div>
    );
  }

  if (view.phase === 'revenge') {
    if (me !== view.revengeBy)
      return <Notice tone="warn">{t('mafia.revengeWait', { name: name(view.revengeBy) })}</Notice>;
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-black">{t('mafia.revengePick')}</h2>
        <PlayerPicker players={alive} value={pick} onChange={setPick} />
        <Button
          size="lg"
          variant="danger"
          disabled={!pick}
          onClick={() => pick && dispatch({ type: 'revenge', target: pick })}
          data-testid="revenge"
        >
          🏹 {t('common.confirm')}
        </Button>
      </div>
    );
  }

  if (view.phase === 'day') {
    return (
      <div className="flex flex-col gap-3">
        {header}
        {view.me?.silenced && <Notice tone="danger">🤐 {t('mafia.youSilenced')}</Notice>}
        {view.endsAt && (
          <Timer
            endsAt={view.endsAt}
            total={Math.round((view.endsAt - now()) / 1000)}
            now={now}
            onTick={(s) => s > 0 && play('tick')}
          />
        )}
        {dawn}
        {view.me && (
          <HoldReveal className="h-40" label={t('hw.peekRole')}>
            <RoleCard view={view} />
          </HoldReveal>
        )}
        <Notes view={view} />
        {view.dayShots.map((sh, i) => (
          <Notice key={i} tone={sh.died ? 'danger' : 'info'}>
            🔫{' '}
            {t(sh.died ? 'mafia.shotDied' : 'mafia.shotMissed', { by: name(sh.by), name: name(sh.target) })}
          </Notice>
        ))}
        {view.me?.hasGun && (
          <Card className="flex flex-col gap-2" data-testid="gun">
            <b>🔫 {t('mafia.youHaveGun')}</b>
            <PlayerPicker players={alive.filter((p) => p.id !== me)} value={pick} onChange={setPick} />
            <Button
              variant="danger"
              disabled={!pick}
              onClick={() => pick && (dispatch({ type: 'shoot', target: pick }), setPick(null), play('buzz'))}
              data-testid="shoot"
            >
              {t('mafia.shoot')}
            </Button>
          </Card>
        )}
        {isHost && (
          <Button size="lg" onClick={() => dispatch({ type: 'startVote' })} data-testid="start-vote">
            {t('hw.startVote')}
          </Button>
        )}
        <DeadList view={view} />
      </div>
    );
  }

  const tallyCard = view.firstTally && (
    <Card className="flex flex-col gap-1 text-sm" data-testid="first-tally">
      {Object.entries(view.firstTally)
        .filter(([id]) => id !== SKIP)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => (
          <span key={id} className={cn(view.defendants.includes(id) && 'text-danger font-black')}>
            {name(id)}: {num(n)}
          </span>
        ))}
    </Card>
  );

  if (view.phase === 'defense') {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <h2 className="text-xl font-black">⚖️ {t('mafia.defenseTitle')}</h2>
        <p className="text-muted text-sm">{t('mafia.defenseHint')}</p>
        {view.endsAt && (
          <Timer
            endsAt={view.endsAt}
            total={Math.round((view.endsAt - now()) / 1000)}
            now={now}
            size={120}
            onTick={(s) => s > 0 && s <= 5 && play('tick')}
          />
        )}
        <div className="flex flex-col gap-2" data-testid="defendants">
          {view.defendants.map((id) => (
            <PlayerChip key={id} name={name(id)} badges={<Badge>⚖️</Badge>} />
          ))}
        </div>
        {tallyCard}
        {isHost && (
          <Button size="lg" onClick={() => dispatch({ type: 'startFinal' })} data-testid="start-final">
            {t('mafia.toFinal')}
          </Button>
        )}
      </div>
    );
  }

  if (view.phase === 'vote' || view.phase === 'final') {
    const isFinal = view.phase === 'final';
    const pool = isFinal ? alive.filter((p) => view.defendants.includes(p.id)) : alive;
    if (view.voteMode === 'host') {
      if (!isHost) return <Notice>{t('hw.hostRecordsVote')}</Notice>;
      return (
        <div className="flex flex-col gap-3">
          {header}
          <h2 className="text-xl font-black">{t('mafia.whoLynched')}</h2>
          <PlayerPicker players={pool} value={pick} onChange={setPick} />
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="lg"
              disabled={!pick}
              onClick={() => pick && (dispatch({ type: 'hostLynch', target: pick }), setPick(null))}
              data-testid="confirm-vote"
            >
              {t('mafia.lynch')}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => dispatch({ type: 'hostLynch', target: null })}
            >
              {t('mafia.noLynchBtn')}
            </Button>
          </div>
        </div>
      );
    }
    const canVote = amAlive && !view.voted.includes(me!);
    return (
      <div className="flex flex-col gap-3">
        {header}
        {canVote ? (
          <>
            <h2 className="text-xl font-black">
              {isFinal ? t('mafia.finalVote') : view.defense ? t('mafia.firstVote') : t('mafia.voteWho')}
            </h2>
            {isFinal && tallyCard}
            <PlayerPicker players={pool.filter((p) => p.id !== me)} value={pick} onChange={setPick} />
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="lg"
                disabled={!pick}
                onClick={() => pick && (dispatch({ type: 'vote', target: pick }), setPick(null))}
                data-testid="confirm-vote"
              >
                {t('hw.castVote')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => dispatch({ type: 'vote', target: SKIP })}
                data-testid="vote-skip"
              >
                {t('mafia.abstain')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Notice>{t('hw.votesIn', { n: view.voted.length, total: view.alive.length })}</Notice>
            {alive.map((p) => (
              <PlayerChip key={p.id} name={p.name} trailing={view.voted.includes(p.id) ? '✅' : '⏳'} />
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {lynchInfo}
      <Notice>{t('common.loading')}</Notice>
    </div>
  );
}

function DeadList({ view }: { view: MafiaView }) {
  const t = useT();
  const dead = view.seats.filter((id) => !view.alive.includes(id));
  if (!dead.length) return null;
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  return (
    <Card className="flex flex-col gap-1">
      <b className="text-muted text-sm">{t('mafia.dead')}</b>
      {dead.map((id) => (
        <span key={id} className="text-sm">
          💀 {name(id)} {view.deadRoles.find((d) => d.id === id)?.role ?? ''}
        </span>
      ))}
    </Card>
  );
}
