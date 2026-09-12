/**
 * /notes page element (v0.44 compiled). Request-time rendered; the props
 * projector lives in app/route-logic/notes.ts. Anonymous requests redirect to
 * /login from the loader, so this page always renders the authenticated
 * variant.
 *
 * The create form opts into data-open-enhance, so duplicate submission
 * behavior is explicit: the enhancement layer ignores a second submit of the
 * same form while one is in flight (#564), turning a double-click into
 * exactly one INSERT. Without JavaScript the form degrades to a native POST
 * whose PRG redirect guards refresh resubmission only — rapid native retries
 * create one row each (the create path is not idempotent).
 *
 * The notes-live island host carries its realtime wiring as compiled
 * island properties (identifier-named host prop Parts — grammar v1 admits no
 * dashed dynamic host attributes); the island's attribute-backed @property
 * fields receive them through the SSR expansion and the client claim.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('notes-page', { root: 'shadow-open' })
export default class NotesPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  whoText = '';

  @property({ reflect: false, attribute: false })
  errorText = '';

  @property({ reflect: false, attribute: false })
  actionErrorText = '';

  @property({ reflect: false, attribute: false })
  titleEcho = '';

  @property({ reflect: false, attribute: false })
  bodyEcho = '';

  @property({ reflect: false, attribute: false })
  noteRows: Array<{ id: string; line: string }> = [];

  @property({ reflect: false, attribute: false })
  nextCursor = '';

  @property({ reflect: false, attribute: false })
  liveUrl = '';

  @property({ reflect: false, attribute: false })
  liveAnonKey = '';

  @property({ reflect: false, attribute: false })
  liveUserId = '';

  @property({ reflect: false, attribute: false })
  liveAccessToken = '';

  @property({ reflect: false, attribute: false })
  liveAccessTokenExpiresAt = '';

  render() {
    return (
      <main>
        <h1>Notes</h1>
        <p id='who'>{this.whoText}</p>
        <p id='error'>{this.errorText}</p>
        <p id='action-error'>{this.actionErrorText}</p>
        <form method='post' action='/notes?/create' data-open-enhance>
          <p>
            <label>
              Title{' '}
              <input
                name='title'
                maxlength={120}
                value={this.titleEcho}
                required
              />
            </label>
          </p>
          <p>
            <label>
              Body <textarea name='body' maxlength={10000}>{this.bodyEcho}</textarea>
            </label>
          </p>
          <button type='submit'>Create note</button>
        </form>
        <ul id='notes'>
          {this.noteRows.map((note) => <li key={note.id}>{note.line}</li>)}
        </ul>
        <form method='get' action='/notes'>
          <input type='hidden' name='cursor' value={this.nextCursor} />
          <button id='next-notes-page' type='submit'>Next page</button>
        </form>
        <notes-live
          liveurl={this.liveUrl}
          livekey={this.liveAnonKey}
          liveuserid={this.liveUserId}
          livetoken={this.liveAccessToken}
          livetokenexpiresat={this.liveAccessTokenExpiresAt}
        >
        </notes-live>
        <form method='post' action='/notes?/logout'>
          <button type='submit'>Sign out</button>
        </form>
        <p>
          <a href='/upload'>Upload a file</a>
        </p>
      </main>
    );
  }
}
