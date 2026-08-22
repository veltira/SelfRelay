import {registerBackground} from './background-core.js';
import {registerRecoveryClaims} from './recovery-claims.js';

registerRecoveryClaims(chrome);
registerBackground(chrome);
