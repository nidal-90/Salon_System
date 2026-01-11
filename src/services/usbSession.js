const STORAGE_KEY = "sibel:usbSession:v1";

export function readSession()
{
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeSession(session) 
{
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() 
{
  localStorage.removeItem(STORAGE_KEY);
}

export function hasCashAccess(session) 
{
  return !!session && (session.role === "cashier" || session.role === "admin");
}
