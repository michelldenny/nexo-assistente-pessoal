import { getSupabase } from "../../../db/supabase";
import {
  CATEGORY_COLORS,
  INCOME_CATEGORIES,
  TRANSACTION_CATEGORIES,
} from "../../categories";

export async function GET() {
  try {
    const { data: custom, error } = await getSupabase()
      .from("custom_categories")
      .select("id, name, kind, color")
      .order("name", { ascending: true });

    if (error) {
      console.error("Erro ao buscar custom_categories:", error);
    }

    const customExpenses = (custom || [])
      .filter((c: { kind: string }) => c.kind === "expense")
      .map((c: { name: string }) => c.name);
    const customIncomes = (custom || [])
      .filter((c: { kind: string }) => c.kind === "income")
      .map((c: { name: string }) => c.name);

    const mergedExpenseCategories = Array.from(
      new Set([...TRANSACTION_CATEGORIES, ...customExpenses]),
    );
    const mergedIncomeCategories = Array.from(
      new Set([...INCOME_CATEGORIES, ...customIncomes]),
    );

    const mergedColors: Record<string, string> = { ...CATEGORY_COLORS };
    for (const c of (custom || []) as Array<{ name: string; color: string }>) {
      if (c.color) {
        mergedColors[c.name] = c.color;
      }
    }

    return Response.json({
      transactionCategories: mergedExpenseCategories,
      incomeCategories: mergedIncomeCategories,
      categoryColors: mergedColors,
      customCategories: custom || [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = (body.name || "").trim();
    const kind = body.kind === "income" ? "income" : "expense";
    const color = (body.color || "").trim() || "#4e83c4";

    if (!name) {
      return Response.json(
        { error: "Nome da categoria é obrigatório." },
        { status: 400 },
      );
    }

    if (name.length > 50) {
      return Response.json(
        { error: "O nome da categoria deve ter no máximo 50 caracteres." },
        { status: 400 },
      );
    }

    const { data, error } = await getSupabase()
      .from("custom_categories")
      .insert([{ name, kind, color }])
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return Response.json(
          { error: "Essa categoria já existe." },
          { status: 409 },
        );
      }
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ category: data }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return Response.json({ error: message }, { status: 500 });
  }
}
