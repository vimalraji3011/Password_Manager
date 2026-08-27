#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

/**
 * Prints a fresh JWT_SECRET and MASTER_ENCRYPTION_KEY.
 *
 * Run once per environment: `npm run genkey`. The encryption key must be backed
 * up somewhere safe — if it is lost, every stored credential becomes
 * permanently unreadable, by design.
 */
const jwtSecret = randomBytes(48).toString('base64url');
const masterKey = randomBytes(32).toString('hex');

console.log(`
Copy these into your .env.local file:

JWT_SECRET=${jwtSecret}
MASTER_ENCRYPTION_KEY=${masterKey}

WARNING: back up MASTER_ENCRYPTION_KEY. Losing it makes every stored
credential permanently unrecoverable. Rotating JWT_SECRET only signs
everyone out.
`);
