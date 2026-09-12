/**
 * /workspace-records page element (v0.44 compiled). Request-time rendered;
 * anonymous GETs redirect to /login from the loader. The invalid-input state
 * is a fully static conditional Region; pagination is a GET form whose hidden
 * inputs ride property Parts (dynamic intrinsic attributes are outside the
 * SSR part schema in grammar v1) so the active filters survive paging.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('workspace-records-page', { root: 'shadow-open' })
export default class WorkspaceRecordsPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  invalid = 0;

  @property({ reflect: false, attribute: false })
  errorText = '';

  @property({ reflect: false, attribute: false })
  recordRows: Array<{ id: string; line: string }> = [];

  @property({ reflect: false, attribute: false })
  nextCursor = '';

  @property({ reflect: false, attribute: false })
  filterWorkspaceId = '';

  @property({ reflect: false, attribute: false })
  filterStatus = '';

  @property({ reflect: false, attribute: false })
  filterTitlePrefix = '';

  render() {
    return (
      <main>
        <h1>Workspace records</h1>
        <p id='error'>{this.errorText}</p>
        <form method='get' action='/workspace-records'>
          <input type='hidden' name='workspace' value={this.filterWorkspaceId} />
          <input type='hidden' name='status' value={this.filterStatus} />
          <input type='hidden' name='q' value={this.filterTitlePrefix} />
          <input type='hidden' name='cursor' value={this.nextCursor} />
          <button id='next-page' type='submit'>Next page</button>
        </form>
        {this.invalid > 0 ? <p id='invalid'>Valid workspace required.</p> : <span></span>}
        <ul id='workspace-records'>
          {this.recordRows.map((record) => <li key={record.id}>{record.line}</li>)}
        </ul>
      </main>
    );
  }
}
