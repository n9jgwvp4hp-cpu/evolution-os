import { redirect } from "next/navigation";

// The assistant is now the home screen. Keep this path working for old links.
export default function ChatRedirect() {
  redirect("/");
}
