import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useListNotifications, useMarkAllNotificationsRead, useMarkNotificationRead, getListNotificationsQueryKey } from "@workspace/api-client-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

function notifIcon(type: string) {
  switch (type) {
    case "lead_assigned": return "👤";
    case "task_assigned": return "✅";
    case "followup_due": return "📅";
    case "task_due": return "⏰";
    default: return "🔔";
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const notifParams = { limit: 20 };
  const { data } = useListNotifications(notifParams, {
    query: { queryKey: getListNotificationsQueryKey(notifParams), refetchInterval: 30000 },
  });

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const totalBadge = (data?.unreadCount ?? 0) + (data?.dueCount ?? 0);

  const handleMarkAll = async () => {
    await markAllRead.mutateAsync();
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  };

  const handleMarkOne = async (id: number) => {
    await markRead.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {totalBadge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground flex items-center justify-center">
              {totalBadge > 99 ? "99+" : totalBadge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {(data?.unreadCount ?? 0) > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-auto py-0.5 px-2" onClick={handleMarkAll}>
              Mark all read
            </Button>
          )}
        </div>

        {data?.dueCount ? (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950 border-b">
            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              ⏰ {data.dueCount} item{data.dueCount !== 1 ? "s" : ""} due or overdue
            </p>
          </div>
        ) : null}

        <div className="max-h-80 overflow-y-auto">
          {!data?.notifications.length ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              No notifications
            </div>
          ) : (
            data.notifications.map(n => (
              <div
                key={n.id}
                className={`px-4 py-3 border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors ${!n.read ? "bg-primary/5" : ""}`}
                onClick={() => !n.read && handleMarkOne(n.id)}
              >
                <div className="flex items-start gap-2">
                  <span className="text-base mt-0.5">{notifIcon(n.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug ${!n.read ? "font-semibold" : "text-muted-foreground"}`}>
                      {n.title}
                    </p>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatDistanceToNow(parseISO(n.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {!n.read && <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1 flex-shrink-0" />}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
