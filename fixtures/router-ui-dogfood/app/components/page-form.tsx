/**
 * /form page — qualifies open-input + open-button form participation on the
 * compiled framework (#1226):
 * - open-input is form-associated (ElementInternals.setFormValue), so a real
 *   <form> submission carries its value;
 * - required + empty value maps to valueMissing on the host validity;
 * - formResetCallback clears the value; formDisabledCallback mirrors a
 *   disabled fieldset ancestor;
 * - open-button type="submit" runs the composed-submit choreography.
 * The form-probe island wires the observable: it writes the submission's
 * FormData entries into #form-output.
 */
import { element, OpenElement } from '@openelement/element';
import '@openelement/ui/open-button';
import '@openelement/ui/open-input';

@element('form-page', { root: 'shadow-open' })
export default class FormPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>ui dogfood — form</h1>
        <form id='dogfood-form'>
          <open-input id='username' name='username' label='Username' required></open-input>
          <open-input
            id='email'
            name='email'
            type='email'
            label='Email'
            value='ada@example.com'
          >
          </open-input>
          <fieldset id='locked-group' disabled>
            <open-input id='locked' name='locked' label='Locked'></open-input>
          </fieldset>
          <open-button id='submit-open' type='submit'>Submit via open-button</open-button>
          <button id='submit-native' type='submit'>Native submit</button>
          <button id='reset-native' type='reset'>Native reset</button>
        </form>
        <form-probe></form-probe>
        <output id='form-output'></output>
      </main>
    );
  }
}
