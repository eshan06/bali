// Bare `tsc --noEmit` (our CI typecheck) doesn't understand CSS side-effect
// imports the way Next's bundler does; declare them so `import './globals.css'`
// type-checks.
declare module '*.css';
