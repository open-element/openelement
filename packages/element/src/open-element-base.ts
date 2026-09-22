import { FacadeErrorCode, OpenElementError } from './internal/core/errors.ts';

/** SSR-safe HTMLElement base without mutating the host global scope. */
export const OpenElementBase: typeof HTMLElement = typeof HTMLElement !== 'undefined'
  ? HTMLElement
  : (class {
    #unsupported(member: string): never {
      throw new OpenElementError(
        `[openElement] HTMLElement.${member} is unavailable during SSR. ` +
          'Move DOM access to a browser lifecycle hook or guard it with typeof document.',
        { code: FacadeErrorCode.SSR_DOM_ACCESS_UNSUPPORTED, phase: 'ssr' },
      );
    }

    hasAttribute(_name: string): boolean {
      return false;
    }
    getAttribute(_name: string): string | null {
      return null;
    }
    setAttribute(_name: string, _value: string): void {}
    removeAttribute(_name: string): void {}
    get tagName(): string {
      return '';
    }
    get isConnected(): boolean {
      return false;
    }
    querySelector(_selector: string): never {
      return this.#unsupported('querySelector()');
    }
    attachShadow(_init: ShadowRootInit): never {
      return this.#unsupported('attachShadow()');
    }
    dispatchEvent(_event: Event): never {
      return this.#unsupported('dispatchEvent()');
    }
  } as unknown as typeof HTMLElement);
