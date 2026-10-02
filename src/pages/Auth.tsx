import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Camera, ChevronLeft, Eye, EyeOff, ImageIcon, MailCheck, Store, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Switch } from "@/components/ui/Switch";
import { InterestPicker } from "@/components/profile/InterestPicker";
import { FullScreenLoader } from "@/components/ui/Spinner";
import { Wordmark } from "@/components/Logo";
import { Screen, spring } from "@/components/motion";
import { normalizeUsername, validateUsername } from "@/lib/constants";
import { resizeImage, uploadMedia } from "@/lib/media";
import { appUrl, cn, errorMessage } from "@/lib/utils";

type Step = "auth" | "forgot" | "check-email" | "reset" | "username" | "interests" | "photo";
type Mode = "login" | "signup";

const ONBOARDING: Step[] = ["auth", "username", "interests", "photo"];

/**
 * Sign-in takes an email or a username. For a username, the database checks
 * the password and only then hands back the account's email (so emails stay
 * private), and Supabase Auth signs in with that as usual.
 */
async function loginEmail(identifier: string, password: string) {
  const id = identifier.trim();
  if (id.includes("@")) return id;
  const { data, error } = await supabase.rpc("login_email", { p_username: id, p_password: password });
  if (error) {
    // The original backend has no username sign-in.
    if (error.code === "PGRST202") throw new Error("Sign in with your email address");
    throw new Error(error.message);
  }
  if (!data) throw new Error("Invalid login credentials");
  return data;
}

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, isLoading, refreshProfile, isPasswordRecovery, clearPasswordRecovery } = useAuth();
  const state = location.state as { from?: string; mode?: Mode } | null;
  const from = state?.from ?? "/map";

  const [step, setStep] = useState<Step>("auth");
  const [mode, setMode] = useState<Mode>(state?.mode ?? "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ file: Blob; preview: string } | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [isBrand, setIsBrand] = useState(false);
  const [busy, setBusy] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Only redirect away while on the sign-in step, so the photo step of
  // onboarding isn't skipped once the username is saved.
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
          options: { emailRedirectTo: appUrl("auth") },
        });
        if (error) throw error;
        if (!data.session) setStep("check-email");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: await loginEmail(email, password), password });
        if (error) throw error;
      }
    } catch (err) {
      const message = errorMessage(err, "Authentication failed");
      const byUsername = mode === "login" && !email.includes("@");
      if (message.includes("already registered")) toast.error("That email is already registered. Try signing in.");
      else if (message.includes("Invalid login")) toast.error(`Incorrect ${byUsername ? "username" : "email"} or password`);
      else toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl("auth") });
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
      const saved = await refreshProfile();
      // The original backend has no interests; skip straight to the photo there.
      setStep(saved && saved.interests === undefined ? "photo" : "interests");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save your username"));
    } finally {
      setBusy(false);
    }
  };

  const saveInterests = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ interests, account_type: isBrand ? "brand" : "person" })
        .eq("user_id", user.id);
      if (error) throw error;
      await refreshProfile();
      setStep("photo");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save your interests"));
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
      const url = await uploadMedia(user.id, await resizeImage(photo.file, 512), "avatar");
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
    if (step === "photo") setStep("interests");
    else if (step === "interests") setStep("username");
    else if (step === "forgot" || step === "check-email") setStep("auth");
    else navigate("/", { replace: true });
  };

  const progress = ONBOARDING.indexOf(step);
  const showBack = step !== "username" && step !== "reset";

  return (
    <Screen>
      <header className="flex shrink-0 items-center justify-between px-3 pt-safe">
        <IconButton label="Back" onClick={back} className={cn(!showBack && "invisible")}>
          <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
        </IconButton>
        {progress > 0 && (
          <div className="flex items-center gap-1.5" aria-label={`Step ${progress + 1} of ${ONBOARDING.length}`}>
            {ONBOARDING.map((s, i) => (
              <motion.span
                key={s}
                animate={{ width: i <= progress ? 28 : 10 }}
                transition={spring.bouncy}
                className={cn("h-2 rounded-full", i <= progress ? "glitch-bg" : "bg-muted")}
              />
            ))}
          </div>
        )}
        <span className="w-11" />
      </header>

      <main className="scroll-area mx-auto flex w-full max-w-sm flex-1 flex-col px-6 pb-safe pt-4">
        <div className="mb-8 text-center">
          <Wordmark className="text-5xl" />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step + mode}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40, transition: { duration: 0.15 } }}
            transition={spring.snappy}
          >
            {step === "auth" && (
              <form onSubmit={submitAuth} className="space-y-5">
                <Heading
                  title={mode === "login" ? "Welcome back" : "Create your account"}
                  subtitle={mode === "login" ? "Sign in to see what’s happening" : "It only takes a minute"}
                />
                <Field label={mode === "login" ? "Email or username" : "Email"} htmlFor="email">
                  <Input
                    id="email"
                    type={mode === "login" ? "text" : "email"}
                    autoComplete={mode === "login" ? "username" : "email"}
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={mode === "login" ? "you@example.com or yourname" : "you@example.com"}
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
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </Field>
                {mode === "login" && (
                  <button
                    type="button"
                    onClick={() => setStep("forgot")}
                    className="-mt-2 block w-full text-right text-sm font-semibold text-muted-foreground"
                  >
                    Forgot password?
                  </button>
                )}
                <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email || !password}>
                  {mode === "login" ? "Sign in" : "Create account"}
                </Button>
                <p className="text-center text-[15px] text-muted-foreground">
                  {mode === "login" ? "New here? " : "Already have an account? "}
                  <button
                    type="button"
                    onClick={() => setMode(mode === "login" ? "signup" : "login")}
                    className="font-bold text-accent"
                  >
                    {mode === "login" ? "Create an account" : "Sign in"}
                  </button>
                </p>
              </form>
            )}

            {step === "forgot" && (
              <form onSubmit={sendReset} className="space-y-5">
                <Heading title="Reset your password" subtitle="We’ll email you a link to choose a new one." />
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
              <div className="space-y-6 text-center">
                <motion.span
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={spring.bouncy}
                  className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent/15 text-accent"
                >
                  <MailCheck className="h-9 w-9" />
                </motion.span>
                <Heading
                  title="Check your email"
                  subtitle={
                    <>
                      We sent a link to <span className="font-semibold text-foreground">{email}</span>. Open it to continue.
                    </>
                  }
                />
                <Button variant="secondary" size="lg" className="w-full" onClick={() => setStep("auth")}>
                  Back to sign in
                </Button>
              </div>
            )}

            {step === "reset" && (
              <form onSubmit={saveNewPassword} className="space-y-5">
                <Heading title="Choose a new password" />
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
                <Heading title="Pick a username" subtitle="This is how people will find you" />
                <Field label="Username" htmlFor="username" error={usernameError} hint="Letters, numbers and underscores">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-muted-foreground">
                      @
                    </span>
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
                <Field label="Name" htmlFor="display-name" hint="Optional">
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

            {step === "interests" && (
              <div className="space-y-6">
                <Heading title="What are you into?" subtitle="Pick a few, and we'll show you the right people and happs" />
                <InterestPicker value={interests} onChange={setInterests} className="justify-center" />
                <label className="flex items-center gap-3 rounded-3xl bg-muted/60 p-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <Store className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">Brand account</span>
                    <span className="block text-xs text-muted-foreground">For venues, promoters, artists and brands</span>
                  </span>
                  <Switch checked={isBrand} onCheckedChange={setIsBrand} label="Brand account" />
                </label>
                <div className="space-y-2">
                  <Button size="lg" className="w-full" loading={busy} onClick={saveInterests} disabled={!interests.length && !isBrand}>
                    Continue
                  </Button>
                  <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setStep("photo")} disabled={busy}>
                    Skip for now
                  </Button>
                </div>
              </div>
            )}

            {step === "photo" && (
              <div className="space-y-6">
                <Heading title="Add a photo" subtitle="Help your friends recognise you" />
                <div className="flex flex-col items-center gap-5">
                  <motion.button
                    type="button"
                    onClick={() => galleryRef.current?.click()}
                    whileTap={{ scale: 0.92 }}
                    transition={spring.bouncy}
                    className="relative rounded-full"
                    aria-label="Choose a photo"
                  >
                    <motion.div key={photo?.preview ?? "empty"} initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={spring.bouncy}>
                      <Avatar
                        src={photo?.preview}
                        name={displayName || username}
                        size="h-36 w-36"
                        className={cn("text-5xl", !photo && "border-[3px] border-dashed border-muted-foreground/30")}
                      />
                    </motion.div>
                    {photo && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Remove photo"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPhoto(null);
                        }}
                        className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background shadow-lg"
                      >
                        <X className="h-4 w-4" />
                      </span>
                    )}
                  </motion.button>
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
          </motion.div>
        </AnimatePresence>
      </main>
    </Screen>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="space-y-1.5 text-center">
      <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>
      {subtitle && <p className="text-[15px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
