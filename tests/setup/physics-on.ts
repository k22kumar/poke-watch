// Runs a test file with the physics flag on, unedited (task I1b; docs/LOCOMOTION.md "Resolvers"): loads Rapier once
// (tests/setup/physics.ts) and sets the default rules' engine to 'rapier' before the test file is imported, so every run
// it creates and every World it builds from the default rules moves the partner through the character controller.
//   npx tsx --import ./tests/setup/physics-on.ts --test tests/locomotion.test.ts tests/jumpcontrol.test.ts
// Not part of `npm test` (the files run there on tiles); the cases these files hold about tile geometry are listed in
// docs/LOCOMOTION.md "Resolvers".
import './physics';
import { defaultRules } from '../../src/rules/defaults';

defaultRules.physics.engine = 'rapier';
