import { SessionView } from "./session-view";

export const metadata = { title: "Session · Marketer" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionView conversationId={decodeURIComponent(id)} />;
}
