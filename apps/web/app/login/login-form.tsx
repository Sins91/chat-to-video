"use client";

import { EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeReturnPath } from "@/lib/internal-auth/return-path";

type LoginFormProps = { configurationInvalid: boolean; returnPath: string };

export function LoginForm({ configurationInvalid, returnPath }: LoginFormProps) {
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(
    configurationInvalid ? "认证服务配置不可用，请联系管理员。" : "",
  );

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!password || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        body: JSON.stringify({ password }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.ok) {
        window.location.assign(safeReturnPath(returnPath));
        return;
      }
      const body = await response.json().catch(() => null) as { message?: unknown } | null;
      setErrorMessage(typeof body?.message === "string" ? body.message : "认证失败，请稍后重试。");
    } catch {
      setErrorMessage("无法连接认证服务，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="mt-8 space-y-2" onSubmit={(event) => void submit(event)}>
      <div className="space-y-1 flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="internal-password">输入密码</label>
        <div className="relative">
          <Input
            aria-describedby={errorMessage ? "login-error" : undefined}
            aria-invalid={Boolean(errorMessage)}
            autoComplete="current-password"
            autoFocus
            className="h-9 bg-background pr-10 focus-visible:border-foreground/40 focus-visible:ring-0"
            disabled={isSubmitting || configurationInvalid}
            id="internal-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="请输入内部访问密码"
            type={isPasswordVisible ? "text" : "password"}
            value={password}
          />
          <Button
            aria-label={isPasswordVisible ? "隐藏密码" : "显示密码"}
            className="absolute right-0.5 top-0.5"
            disabled={isSubmitting || configurationInvalid}
            onClick={() => setIsPasswordVisible((current) => !current)}
            size="icon"
            type="button"
            variant="ghost"
          >
            {isPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        </div>
      </div>
      <div aria-live="polite" className="min-h-5">
        {errorMessage ? <p className="text-sm text-destructive" id="login-error" role="alert">{errorMessage}</p> : null}
      </div>
      <Button className="h-9 px-4" disabled={!password || isSubmitting || configurationInvalid} type="submit">
        {isSubmitting ? <LoaderCircleIcon className="animate-spin" /> : null}
        {isSubmitting ? "正在验证" : "进入工作台"}
      </Button>
    </form>
  );
}
