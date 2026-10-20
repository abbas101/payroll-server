import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Login required' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'payroll-dev-secret-change-in-production');
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}
