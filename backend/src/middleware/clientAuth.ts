import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface ClientRequest extends Request {
  clientId?: string;
}

export function clientAuth(req: ClientRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const payload = jwt.verify(token, process.env.CLIENT_JWT_SECRET!) as { clientId: string };
    req.clientId = payload.clientId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
