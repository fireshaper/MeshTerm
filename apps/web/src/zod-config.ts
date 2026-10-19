import { z } from "zod";

// The server's CSP has no 'unsafe-eval'. zod catches its `new Function` probe, but
// browsers still report the attempt as a violation, so turn the JIT off.
z.config({ jitless: true });
