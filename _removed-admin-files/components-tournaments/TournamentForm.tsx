import { createTournamentAction } from '@/app/tournaments/new/actions'
import { AdminButton } from '@/components/AdminButton'
import { AdminCard } from '@/components/AdminCard'

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-semibold text-slate-800">{children}</label>
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`min-h-11 rounded-xl border border-slate-300 px-3 ${props.className ?? ''}`} />
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`rounded-xl border border-slate-300 px-3 py-2 ${props.className ?? ''}`} />
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`min-h-11 rounded-xl border border-slate-300 px-3 ${props.className ?? ''}`} />
}

function CheckRow({
  name,
  label,
  defaultChecked = false,
  help,
}: {
  name: string
  label: string
  defaultChecked?: boolean
  help?: string
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1 h-4 w-4" />
      <span>
        <span className="block font-semibold text-slate-900">{label}</span>
        {help ? <span className="block text-sm text-slate-600">{help}</span> : null}
      </span>
    </label>
  )
}

export function TournamentForm() {
  return (
    <form action={createTournamentAction} className="grid gap-5">
      <AdminCard>
        <div className="text-lg font-bold text-slate-900">Basic Info</div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="grid gap-2 md:col-span-2">
            <FieldLabel>Name</FieldLabel>
            <TextInput name="name" placeholder="Saturday Skins" required />
          </div>

          <div className="grid gap-2 md:col-span-2">
            <FieldLabel>Description</FieldLabel>
            <TextArea name="description" rows={3} placeholder="Optional description" />
          </div>

          <div className="grid gap-2">
            <FieldLabel>Start date</FieldLabel>
            <TextInput name="start_date" type="date" required />
          </div>

          <div className="grid gap-2">
            <FieldLabel>End date</FieldLabel>
            <TextInput name="end_date" type="date" required />
          </div>

          <div className="grid gap-2">
            <FieldLabel>Invite code</FieldLabel>
            <TextInput name="invite_code" placeholder="Leave blank to auto-generate" />
          </div>

          <div className="grid gap-2">
            <FieldLabel>Status</FieldLabel>
            <Select name="status" defaultValue="active">
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </Select>
          </div>

          <div className="grid gap-2">
            <FieldLabel>Confirmation rule</FieldLabel>
            <Select name="confirmation_rule" defaultValue="all_players">
              <option value="all_players">All players</option>
              <option value="majority">Majority</option>
            </Select>
          </div>
        </div>
      </AdminCard>

      <AdminCard>
        <div className="text-lg font-bold text-slate-900">Format and Visibility</div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <FieldLabel>Event category</FieldLabel>
            <Select name="event_category" defaultValue="standard_tournament">
              <option value="standard_tournament">Standard tournament</option>
              <option value="mini_tournament">Mini tournament</option>
              <option value="recurring_game">Recurring game</option>
            </Select>
          </div>

          <div className="grid gap-2">
            <FieldLabel>Format type</FieldLabel>
            <Select name="format_type" defaultValue="individual_stroke_play">
              <option value="individual_stroke_play">Individual stroke play</option>
              <option value="scramble">Scramble</option>
              <option value="ironman_team_scramble">Ironman team scramble</option>
            </Select>
          </div>

          <div className="grid gap-2">
            <FieldLabel>Visibility</FieldLabel>
            <Select name="visibility" defaultValue="public">
              <option value="public">Public</option>
              <option value="private">Private</option>
            </Select>
          </div>

          <div className="grid gap-2">
            <FieldLabel>Max active players</FieldLabel>
            <TextInput name="max_active_players" type="number" min={1} defaultValue={4} />
          </div>

          <div className="md:col-span-2 grid gap-3">
            <CheckRow
              name="invite_code_active"
              label="Invite code active"
              defaultChecked
              help="Public tournaments can keep this active until full. Private tournaments can expire it when full."
            />
            <CheckRow
              name="allow_direct_add"
              label="Allow direct add"
              defaultChecked
              help="Lets the owner add players directly instead of only using the invite code."
            />
          </div>
        </div>
      </AdminCard>

      <AdminCard>
        <div className="text-lg font-bold text-slate-900">Recurring and Side Games</div>
        <div className="mt-4 grid gap-4">
          <CheckRow
            name="is_recurring"
            label="Recurring tournament/game"
            help="Use this for weekly or repeating games. Add a simple recurrence note below."
          />

          <div className="grid gap-2">
            <FieldLabel>Recurrence rule</FieldLabel>
            <TextInput name="recurrence_rule" placeholder="Example: Every Saturday" />
          </div>

          <div className="grid gap-2">
            <FieldLabel>Default payout mode</FieldLabel>
            <Select name="default_payout_mode" defaultValue="pay_weekly">
              <option value="pay_weekly">Pay weekly</option>
              <option value="let_it_ride">Let it ride</option>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <CheckRow
              name="birdie_pot_enabled"
              label="Enable Birdie Pot"
              help="Track par-3 birdies and surface Birdie Pot events."
            />
            <CheckRow
              name="skins_enabled"
              label="Enable Skins"
              help="Use this for skins and other money-game scoring layers."
            />
            <CheckRow
              name="carry_balances_enabled"
              label="Carry balances"
              help="Keep weekly balances running instead of settling immediately."
            />
          </div>
        </div>
      </AdminCard>

      <div className="flex justify-end">
        <AdminButton type="submit">Create Tournament</AdminButton>
      </div>
    </form>
  )
}
