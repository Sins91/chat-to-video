import { LoginForm } from "@/app/login/login-form";
import { safeReturnPath } from "@/lib/internal-auth/return-path";

type LoginPageProps = {
  searchParams: Promise<{ configuration?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 pb-20 text-foreground">
      <section className="w-full max-w-[22rem]">
        <header>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">fifiltv</p>
          <h1 className="text-lg font-bold tracking-[0.14em] text-oreground ">chat to video</h1>
        </header>
        <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
          此工作台仅供内部人员访问。<br />
        </p>
        <LoginForm
          configurationInvalid={parameters.configuration === "invalid"}
          returnPath={safeReturnPath(parameters.next)}
        />
      </section>
    </main>
  );
}
