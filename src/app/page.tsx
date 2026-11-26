import { redirect } from "next/navigation";

// There is no public landing page: /login sends visitors on to /setup or /inbox as needed.
export default function HomePage() {
  redirect("/login");
}
