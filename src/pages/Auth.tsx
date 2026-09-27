import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Camera, ChevronLeft, Eye, EyeOff, ImageIcon, MailCheck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { FullScreenLoader } from "@/components/ui/Spinner";
import { Wordmark } from "@/components/Logo";
import { normalizeUsername, validateUsername } from "@/lib/constants";
import { resizeImage, uploadMedia } from "@/lib/media";
import { cn, errorMessage } from "@/lib/utils";

type Step = "auth" | "forgot" | "check-email" | "reset" | "username" | "photo";
type Mode = "login" | "signup";

const ONBOARDING: Step[] = ["auth", "username", "photo"];

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, isLoading, refreshProfile, isPasswordRecovery, clearPasswordRecovery } = useAuth();
  const from = (location.state as { from?: string } | null)?.from ?? "/map";

  const [step, setStep] = useState<Step>("auth");
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ file: Blob; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Route the user to the right step. Only redirect away while on the sign-in
  // step: the old app bounced to the map as soon as a username was saved, so
  // the "add a photo" step was never shown.
  useEffect(() => {
    if (isLoading) return;
    if (isPasswordRecovery) {
      setStep("reset");
      return;
    }
    if (!user) return;
    if (step === "auth" || step === "check-email") {
      if (profile?.username) navigate(from, { replace: true });
      else setStep("username");
    }
  }, [isLoading, user, profile, step, from, navigate, isPasswordRecovery]);

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.preview);
    },
    [photo],
  );

  if (isLoading) return <FullScreenLoader />;

  const submitAuth = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });
        if (error) throw error;
        // With email confirmation on there's no session yet — the old app
        // carried on to the username step and then failed to save it.
        if (!data.session) setStep("check-email");
        else toast.success("Account created — let’s set up your profile");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (err) {
      const message = errorMessage(err, "Authentication failed");
      if (message.includes("already registered")) toast.error("That email is already registered. Try signing in.");
      else if (message.includes("Invalid login")) toast.error("Incorrect email or password");
      else toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth`,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else setStep("check-email");
  };

  const saveNewPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    clearPasswordRecovery();
    setPassword("");
    setStep("auth");
  };

  const saveUsername = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const value = normalizeUsername(username);
    const invalid = validateUsername(value);
    if (invalid) {
      setUsernameError(invalid);
      return;
    }
    setBusy(true);
    try {
      const { data: taken } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("username", value)
        .neq("user_id", user.id)
        .maybeSingle();
      if (taken) {
        setUsernameError("That username is taken");
        return;
      }
      const { error } = await supabase
        .from("profiles")
        .update({ username: value, display_name: displayName.trim() || value })
        .eq("user_id", user.id);
      if (error) {
        if (error.code === "23505") setUsernameError("That username is taken");
        else throw error;
        return;
      }
      setStep("photo");
      await refreshProfile();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save your username"));
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Please choose an image under 15 MB");
      return;
    }
    setPhoto({ file, preview: URL.createObjectURL(file) });
  };

  const finish = () => {
    toast.success("Welcome to The Happs!");
    navigate(from, { replace: true });
  };

  const savePhoto = async () => {
    if (!user || !photo) return finish();
    setBusy(true);
    try {
      const resized = await resizeImage(photo.file, 512);
      const url = await uploadMedia(user.id, resized, "avatar");
      const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("user_id", user.id);
      if (error) throw error;
      await refreshProfile();
      finish();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't upload your photo"));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (step === "photo") setStep("username");
    else if (step === "forgot" || step === "check-email") setStep("auth");
    else navigate("/", { replace: true });
  };

  const progress = ONBOARDING.indexOf(step);
  const showBack = step !== "username" && step !== "reset";

  return (
    <div className="flex min-h-dvh-screen flex-col bg-background">
      <header className="flex items-center justify-between px-3 pt-safe">
        <IconButton label="Back" variant="ghost" onClick={back} className={cn(!showBack && "invisible")}>
          <ChevronLeft className="h-6 w-6" />
        </IconButton>
        {progress >= 0 && (
          <div className="flex items-center gap-1.5" aria-label={`Step ${progress + 1} of 3`}>
            {ONBOARDING.map((s, i) => (
              <span
                key={s}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-500 ease-smooth",
                  i <= progress ? "w-7 bg-accent" : "w-3 bg-muted",
                )}
              />
            ))}
          </div>
        )}
        <span className="w-11" />
      </header>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col px-6 pb-safe pt-6">
        <Wordmark className="mb-10 block text-center text-5xl text-accent" />

        <div key={step} className="animate-fade-up">
          {step === "auth" && (
            <form onSubmit={submitAuth} className="space-y-5">
              <div className="space-y-1 text-center">
                <h1 className="text-2xl font-bold tracking-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
                <p className="text-sm text-muted-foreground">
                  {mode === "login" ? "Sign in to see what’s happening" : "Join The Happs in seconds"}
                </p>
              </div>

              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>

              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </Field>

              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => setStep("forgot")}
                  className="-mt-2 block w-full text-right text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Forgot password?
                </button>
              )}

              <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email || !password}>
                {mode === "login" ? "Sign in" : "Create account"}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {mode === "login" ? "New here? " : "Already have an account? "}
                <button
                  type="button"
                  onClick={() => setMode(mode === "login" ? "signup" : "login")}
                  className="font-semibold text-accent"
                >
                  {mode === "login" ? "Create an account" : "Sign in"}
                </button>
              </p>
            </form>
          )}

          {step === "forgot" && (
            <form onSubmit={sendReset} className="space-y-5">
              <div className="space-y-1 text-center">
                <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
                <p className="text-sm text-muted-foreground">We’ll email you a link to choose a new one.</p>
              </div>
              <Field label="Email" htmlFor="reset-email">
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email}>
                Send reset link
              </Button>
            </form>
          )}

          {step === "check-email" && (
            <div className="space-y-5 text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-accent">
                <MailCheck className="h-8 w-8" />
              </span>
              <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
                <p className="text-sm text-muted-foreground">
                  We sent a link to <span className="font-medium text-foreground">{email}</span>. Open it on this device to
                  continue.
                </p>
              </div>
              <Button variant="secondary" className="w-full" onClick={() => setStep("auth")}>
                Back to sign in
              </Button>
            </div>
          )}

          {step === "reset" && (
            <form onSubmit={saveNewPassword} className="space-y-5">
              <div className="space-y-1 text-center">
                <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
              </div>
              <Field label="New password" htmlFor="new-password">
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={busy} disabled={password.length < 6}>
                Update password
              </Button>
            </form>
          )}

          {step === "username" && (
            <form onSubmit={saveUsername} className="space-y-5">
              <div className="space-y-1 text-center">
                <h1 className="text-2xl font-bold tracking-tight">Pick a username</h1>
                <p className="text-sm text-muted-foreground">This is how people will find you</p>
              </div>

              <Field label="Username" htmlFor="username" error={usernameError} hint="Letters, numbers and underscores">
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
                  <Input
                    id="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={20}
                    value={username}
                    invalid={Boolean(usernameError)}
                    onChange={(e) => {
                      setUsername(normalizeUsername(e.target.value));
                      setUsernameError(null);
                    }}
                    placeholder="yourname"
                    className="pl-9"
                  />
                </div>
              </Field>

              <Field label="Display name" htmlFor="display-name" hint="Optional">
                <Input
                  id="display-name"
                  autoComplete="name"
                  maxLength={50}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                />
              </Field>

              <Button type="submit" size="lg" className="w-full" loading={busy} disabled={username.length < 3}>
                Continue
              </Button>
            </form>
          )}

          {step === "photo" && (
            <div className="space-y-6">
              <div className="space-y-1 text-center">
                <h1 className="text-2xl font-bold tracking-tight">Add a profile photo</h1>
                <p className="text-sm text-muted-foreground">Help your friends recognise you</p>
              </div>

              <div className="flex flex-col items-center gap-5">
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="relative rounded-full transition-transform active:scale-95"
                  aria-label="Choose a photo"
                >
                  <Avatar
                    src={photo?.preview}
                    name={displayName || username}
                    size="h-32 w-32"
                    className={cn("text-4xl", !photo && "border-2 border-dashed border-muted-foreground/30")}
                  />
                  {photo && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Remove photo"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPhoto(null);
                      }}
                      className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background shadow-md"
                    >
                      <X className="h-4 w-4" />
                    </span>
                  )}
                </button>

                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => cameraRef.current?.click()}>
                    <Camera className="h-4 w-4" /> Camera
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => galleryRef.current?.click()}>
                    <ImageIcon className="h-4 w-4" /> Library
                  </Button>
                </div>

                <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  hidden
                  onChange={(e) => pickPhoto(e.target.files?.[0])}
                />
              </div>

              <div className="space-y-2">
                <Button size="lg" className="w-full" loading={busy} onClick={savePhoto} disabled={!photo}>
                  Save & continue
                </Button>
                <Button variant="ghost" className="w-full text-muted-foreground" onClick={finish} disabled={busy}>
                  Skip for now
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
