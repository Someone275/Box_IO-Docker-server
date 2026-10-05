import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db, jwtSecret, userCount } from "./db.js";
import type { JwtUser, UserRole } from "./types.js";

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function checkPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(user: JwtUser): string {
  return jwt.sign(user, jwtSecret(), { expiresIn: "14d" });
}

export function readToken(token: string): JwtUser | null {
  try {
    return jwt.verify(token, jwtSecret()) as JwtUser;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  user: JwtUser;
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : (req.query.token as string | undefined);
  if (!token) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  const tokenUser = readToken(token);
  if (!tokenUser) {
    res.status(401).json({ error: "Session expired" });
    return;
  }
  const row = findUserById(tokenUser.id);
  if (!row) {
    res.status(401).json({ error: "Account not found" });
    return;
  }
  (req as AuthedRequest).user = { id: row.id, username: row.username, role: row.role };
  next();
}

export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = (req as AuthedRequest).user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function findUserByUsername(username: string) {
  return db
    .prepare(
      "SELECT id, username, password_hash, email, role FROM users WHERE username = ?",
    )
    .get(username) as
    | {
        id: number;
        username: string;
        password_hash: string;
        email: string;
        role: UserRole;
      }
    | undefined;
}

export function findUserById(id: number) {
  return db
    .prepare("SELECT id, username, email, role, created_at FROM users WHERE id = ?")
    .get(id) as
    | {
        id: number;
        username: string;
        email: string;
        role: UserRole;
        created_at: string;
      }
    | undefined;
}

export function createUser(
  username: string,
  password: string,
  email: string,
  role: UserRole,
): number {
  const result = db
    .prepare(
      "INSERT INTO users (username, password_hash, email, role) VALUES (?, ?, ?, ?)",
    )
    .run(username.trim(), hashPassword(password), email.trim(), role);
  return Number(result.lastInsertRowid);
}

export function needsSetup(): boolean {
  return userCount() === 0;
}
