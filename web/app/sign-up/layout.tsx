import { ClerkProvider } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      {children}
    </ClerkProvider>
  );
}
