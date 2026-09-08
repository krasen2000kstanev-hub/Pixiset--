import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in — Client Gallery" };

export default function LoginPage() {
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-6 font-serif text-2xl">Admin sign in</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
