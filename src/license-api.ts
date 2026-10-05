import type { Router } from "express";
import { z } from "zod";
import { adminMiddleware, authMiddleware, type AuthedRequest } from "./auth.js";
import {
  clearLicenseToken,
  confirmInstalledLicense,
  licenseServerReachable,
  licenseServerUrl,
  licenseSummary,
  licenseToken,
  listRemoteLicenses,
  loginToLicenseServer,
  pullRemoteLicense,
  refreshLicenseFromServer,
  returnInstalledLicense,
  uploadLicenseFile,
} from "./license.js";

export function mountLicenseRoutes(router: Router): void {
  router.get("/license/status", authMiddleware, async (req, res) => {
    const { user } = req as AuthedRequest;
    let summary = licenseSummary();
    let reachable = false;
    let licenses: unknown[] = [];
    const remote = (async () => {
      await refreshLicenseFromServer();
      summary = licenseSummary();
      reachable = await licenseServerReachable();
      if (reachable && licenseToken() && user.role === "admin") {
        try {
          licenses = await listRemoteLicenses();
        } catch {
          licenses = [];
        }
      }
    })();
    await Promise.race([remote, new Promise((resolve) => setTimeout(resolve, 6000))]);
    res.json({
      ...summary,
      reachable,
      signedIn: Boolean(licenseToken()),
      server: licenseServerUrl(),
      canInstall: user.role === "admin",
      licenses,
    });
  });

  router.post("/license/login", authMiddleware, adminMiddleware, async (req, res) => {
    const parsed = z.object({ username: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }
    try {
      const session = await loginToLicenseServer(parsed.data.username, parsed.data.password);
      res.json({ ok: true, username: session.username, licenses: session.licenses });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : "Sign-in failed" });
    }
  });

  router.post("/license/pull", authMiddleware, adminMiddleware, async (req, res) => {
    const parsed = z.object({ licenseId: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose a license" });
      return;
    }
    try {
      const document = await pullRemoteLicense(parsed.data.licenseId);
      res.json({ ok: true, licensed: true, expiresAt: document.expiresAt, kind: document.kind });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Install failed" });
    }
  });

  router.post("/license/upload", authMiddleware, adminMiddleware, (req, res) => {
    try {
      const result = uploadLicenseFile(req.body?.document ?? req.body);
      res.json({ ok: true, ...result, ...licenseSummary() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
    }
  });

  router.post("/license/confirm", authMiddleware, adminMiddleware, (req, res) => {
    const code = String(req.body?.code || "");
    if (!code) {
      res.status(400).json({ error: "Confirmation code required" });
      return;
    }
    try {
      confirmInstalledLicense(code);
      res.json({ ok: true, ...licenseSummary() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Confirmation failed" });
    }
  });

  router.post("/license/return", authMiddleware, adminMiddleware, async (_req, res) => {
    try {
      await returnInstalledLicense();
      res.json({ ok: true, ...licenseSummary() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Could not return the license" });
    }
  });

  router.post("/license/disconnect", authMiddleware, adminMiddleware, (_req, res) => {
    clearLicenseToken();
    res.json({ ok: true });
  });
}
