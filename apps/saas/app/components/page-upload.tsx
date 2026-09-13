/**
 * /upload page element (v0.44 compiled). Request-time rendered; anonymous
 * GETs redirect to /login from the loader. The files list renders one text
 * line per row (grammar v1 list Regions carry one value slot per item and no
 * per-item attributes, so the 0.43 per-row download links/delete forms are
 * outside v1); deletion posts the object key from the section-level form.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('upload-page', { root: 'shadow-open' })
export default class UploadPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  whoText = '';

  @property({ reflect: false, attribute: false })
  errorText = '';

  @property({ reflect: false, attribute: false })
  actionErrorText = '';

  @property({ reflect: false, attribute: false })
  fileRows: Array<{ id: string; line: string }> = [];

  render() {
    return (
      <main>
        <h1>Upload</h1>
        <p id='who'>{this.whoText}</p>
        <p id='error'>{this.errorText}</p>
        <p id='action-error'>{this.actionErrorText}</p>
        <form
          method='post'
          action='/upload?/upload'
          enctype='multipart/form-data'
        >
          <p>
            <label>
              File <input type='file' name='file' required />
            </label>
          </p>
          <button type='submit'>Upload</button>
        </form>
        <ul id='files'>
          {this.fileRows.map((file) => <li key={file.id}>{file.line}</li>)}
        </ul>
        <form method='post' action='/upload?/delete'>
          <p>
            <label>
              Object key <input type='text' name='key' required />
            </label>
          </p>
          <button type='submit'>Delete</button>
        </form>
        <p>
          <a href='/notes'>Back to notes</a>
        </p>
      </main>
    );
  }
}
