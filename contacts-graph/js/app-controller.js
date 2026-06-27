/**
 * Controller assembly point.
 *
 * `app.js` defines the core ContactRelationshipApp class (constructor + the
 * central rebuild/index pipeline). Cohesive method groups live in sibling
 * "mixin" modules that graft themselves onto the prototype. Importing this
 * module guarantees the prototype is fully assembled before the class is used,
 * so both the browser entry (app-bootstrap.js) and the test harness import the
 * controller from here rather than from app.js directly.
 */
import { ContactRelationshipApp } from './app.js';
import './app-notes.js';
import './app-session.js';
import './app-bulk.js';

export { ContactRelationshipApp };
