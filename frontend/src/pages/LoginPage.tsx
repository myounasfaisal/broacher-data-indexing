import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ui/theme-toggle";

type Mode = "signin" | "signup" | "forgot";

const COPY: Record<Mode, { title: string; subtitle: string }> = {
  signin: {
    title: "Sign in",
    subtitle: "Sign in to compare and manage brochures",
  },
  signup: {
    title: "Create an account",
    subtitle: "Register to start extracting chemical brochures",
  },
  forgot: {
    title: "Reset your password",
    subtitle: "Enter your email and we'll send you a reset link",
  },
};

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-app px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle className="border border-line" />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-on-brand shadow-sm">
            <FlaskConical className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-fg">
            Brochure<span className="text-brand-text">DB</span>
          </span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{COPY[mode].title}</CardTitle>
            <p className="mt-1 text-sm text-fg-muted">{COPY[mode].subtitle}</p>
          </CardHeader>
          <CardContent>
            {mode === "forgot" ? (
              <ForgotPasswordForm onBack={() => setMode("signin")} />
            ) : (
              <CredentialsForm mode={mode} onModeChange={setMode} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Email/password auth schema (sign in + sign up).
const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
type CredentialsValues = z.infer<typeof credentialsSchema>;

function CredentialsForm({
  mode,
  onModeChange,
}: {
  mode: "signin" | "signup";
  onModeChange: (next: Mode) => void;
}) {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const isSignUp = mode === "signup";
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<CredentialsValues>({ resolver: zodResolver(credentialsSchema) });

  async function onSubmit(values: CredentialsValues) {
    setSubmitting(true);
    try {
      if (isSignUp) {
        const session = await signUp(values.email, values.password);
        if (session) {
          // Already signed in (email confirmation disabled) — go straight in.
          toast.success("Account created — welcome!");
          navigate("/", { replace: true });
        } else {
          toast.success(
            "Account created! Check your email to confirm, then sign in.",
          );
          onModeChange("signin");
          reset();
        }
      } else {
        await signIn(values.email, values.password);
        navigate("/", { replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register("email")} />
        {errors.email && (
          <p className="text-xs text-danger-text">{errors.email.message}</p>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          {!isSignUp && (
            <button
              type="button"
              className="text-xs text-brand-text hover:underline"
              onClick={() => onModeChange("forgot")}
            >
              Forgot password?
            </button>
          )}
        </div>
        <Input id="password" type="password" {...register("password")} />
        {errors.password && (
          <p className="text-xs text-danger-text">{errors.password.message}</p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting
          ? isSignUp
            ? "Creating account…"
            : "Signing in…"
          : isSignUp
          ? "Sign up"
          : "Sign in"}
      </Button>
      <div className="text-center text-sm">
        <button
          type="button"
          className="text-brand-text hover:underline"
          onClick={() => {
            onModeChange(isSignUp ? "signin" : "signup");
            reset();
          }}
        >
          {isSignUp
            ? "Already have an account? Sign in"
            : "Don't have an account? Sign up"}
        </button>
      </div>
    </form>
  );
}

// Forgot-password: email only; Supabase emails a link to /reset-password.
const emailSchema = z.object({
  email: z.string().email("Enter a valid email"),
});
type EmailValues = z.infer<typeof emailSchema>;

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const { resetPassword } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailValues>({ resolver: zodResolver(emailSchema) });

  async function onSubmit(values: EmailValues) {
    setSubmitting(true);
    try {
      await resetPassword(values.email);
      toast.success("Check your email for a password reset link.");
      onBack();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not send the reset email",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register("email")} />
        {errors.email && (
          <p className="text-xs text-danger-text">{errors.email.message}</p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Sending link…" : "Send reset link"}
      </Button>
      <div className="text-center text-sm">
        <button
          type="button"
          className="text-brand-text hover:underline"
          onClick={onBack}
        >
          Back to sign in
        </button>
      </div>
    </form>
  );
}
