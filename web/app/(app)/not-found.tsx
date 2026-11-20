import { ButtonLink, Card } from "@/design-system";

export default function NotFound() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-[420px] p-5">
        <h1 className="text-[15px] font-medium">Couldn&apos;t find that page</h1>
        <p className="mt-1.5 text-[13px] text-fg-muted">It doesn&apos;t exist or has moved.</p>
        <div className="mt-4">
          <ButtonLink href="/home" variant="primary">
            Go home
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
