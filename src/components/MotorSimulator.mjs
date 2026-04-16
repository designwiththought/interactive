import React from 'react';
import htm from 'htm';

const html = htm.bind(React.createElement);

// Server-renders the full DOM skeleton of the simulator.
// All interactivity lives in /client/motor.js.
export default function MotorSimulator() {
  return html`
    <div className="sim-shell" data-motor-sim>

      <aside className="sim-controls" aria-label="Simulation controls">
        <h3>Simulation controls</h3>

        <fieldset className="control-group">
          <legend>Mode</legend>
          <p className="control-group-hint">What's shaking your input?</p>
          <div className="segmented" role="group" aria-label="Mode">
            <button type="button" data-mode="tremor" aria-pressed="true">Tremor</button>
            <button type="button" data-mode="bumpy" aria-pressed="false">Bumpy ride</button>
            <button type="button" data-mode="both"  aria-pressed="false">Both</button>
          </div>
        </fieldset>

        <fieldset className="control-group">
          <legend>Intensity</legend>
          <p className="control-group-hint">How much is your hand moving?</p>
          <div className="segmented" role="group" aria-label="Intensity">
            <button type="button" data-intensity="light"    aria-pressed="false">Light</button>
            <button type="button" data-intensity="moderate" aria-pressed="true">Moderate</button>
            <button type="button" data-intensity="severe"   aria-pressed="false">Severe</button>
          </div>
        </fieldset>

        <div className="control-group">
          <button type="button" className="btn btn-primary btn-lg" data-sim-start style=${{ width: '100%' }}>
            Start simulation
          </button>
          <button type="button" className="btn" data-sim-reset hidden style=${{ width: '100%', marginTop: 'var(--space-2)' }}>
            Reset
          </button>
        </div>

        <p className="muted" style=${{ fontSize: 'var(--fs-sm)' }}>
          Motion can be uncomfortable. Stop anytime with the reset button,
          or turn off the mode you don't want to feel.
        </p>
      </aside>

      <section className="sim-stage" data-sim-stage data-state="idle" aria-live="polite">

        <div className="sim-idle" data-sim-idle>
          <p className="eyebrow">Scenario</p>
          <h3>You need to finish three small things.</h3>
          <p className="muted">
            Accept a terms update, fix a detail on your profile, and confirm a payment.
            Tasks you do all the time — now with unsteady hands. Pick a mode, set the intensity,
            and press <strong>Start simulation</strong>.
          </p>
        </div>

        <div className="sim-surface" data-sim-surface hidden>
          <dl className="sim-meter" aria-label="Live statistics">
            <div><dt>Task</dt>         <dd data-stat-task>1 / 3</dd></div>
            <div><dt>Time</dt>         <dd data-stat-time>0.0s</dd></div>
            <div><dt>Missed taps</dt>  <dd data-stat-miss>0</dd></div>
            <div><dt>Re-taps</dt>      <dd data-stat-retap>0</dd></div>
          </dl>

          <div className="task-progress" aria-hidden="true">
            <div className="task-progress-step" data-status="active"></div>
            <div className="task-progress-step"></div>
            <div className="task-progress-step"></div>
          </div>

          <div className="task-card" data-task="1" data-active="true">
            <h4>We've updated our terms</h4>
            <p className="task-hint">Agree to continue. If you don't agree, you'll need to close the app.</p>
            <div className="task-button-row">
              <button type="button" className="btn task-tiny" data-task-target="task1.agree">Agree</button>
              <button type="button" className="btn task-tiny">Decline</button>
              <button type="button" className="btn task-tiny">Remind me later</button>
              <button type="button" className="btn task-tiny">See what changed</button>
            </div>
          </div>

          <div className="task-card" data-task="2">
            <h4>Fix a typo on your profile</h4>
            <p className="task-hint">Type <code>Alex Rivera</code> into the name field exactly, then press Save.</p>
            <form className="task-form" data-task-form onSubmit=${(e) => e.preventDefault()}>
              <div>
                <label htmlFor="profile-name">Full name</label>
                <input type="text" id="profile-name" name="name" autoComplete="off" />
              </div>
              <div>
                <label htmlFor="profile-email">Email</label>
                <input type="email" id="profile-email" name="email" defaultValue="alex@example.com" autoComplete="off" />
              </div>
              <div>
                <button type="submit" className="btn btn-primary" data-task-target="task2.save">Save profile</button>
              </div>
            </form>
          </div>

          <div className="task-card" data-task="3">
            <h4>Confirm your payment</h4>
            <p className="task-hint">Tick the two required boxes, then press Pay $4.20.</p>
            <ul className="task-checklist">
              <li>
                <input type="checkbox" id="chk-terms" data-task-check="terms" />
                <label htmlFor="chk-terms">I agree to the service terms.</label>
              </li>
              <li>
                <input type="checkbox" id="chk-receipts" data-task-check="receipts" />
                <label htmlFor="chk-receipts">Email me a receipt.</label>
              </li>
              <li>
                <input type="checkbox" id="chk-newsletter" />
                <label htmlFor="chk-newsletter">Sign me up for product updates (optional).</label>
              </li>
            </ul>
            <button type="button" className="btn btn-primary" data-task-target="task3.pay">Pay $4.20</button>
          </div>
        </div>

        <div className="sim-done" data-sim-done>
          <p className="eyebrow">Done</p>
          <h3>You made it through.</h3>
          <p className="muted">Here's what that cost you.</p>
          <div className="sim-done-stats">
            <div className="sim-done-stat"><strong data-done-time>0.0s</strong><span>Total time</span></div>
            <div className="sim-done-stat"><strong data-done-miss>0</strong><span>Missed taps</span></div>
            <div className="sim-done-stat"><strong data-done-retap>0</strong><span>Re-taps</span></div>
          </div>
        </div>

      </section>
    </div>
  `;
}
