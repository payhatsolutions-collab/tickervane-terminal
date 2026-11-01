import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export default function ConnectionStatus() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  return online ? null : <div className="connection-status" role="status"><WifiOff size={16} /><span>You’re offline. Saved research is still on this device. Quotes refresh when you reconnect.</span></div>;
}
