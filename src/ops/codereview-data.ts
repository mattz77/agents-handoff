import { pg } from "../infra/postgres";

export async function getCodeReviewData(slug?: string) {
  try {
    const { rows } = slug
      ? await pg.query(
          `select r.*, p.display_name from codereview_reports r
           join handoff_projects p on p.slug = r.project_slug
           where r.project_slug = $1
           order by r.created_at desc limit 20`,
          [slug]
        )
      : await pg.query(
          `select r.*, p.display_name from codereview_reports r
           join handoff_projects p on p.slug = r.project_slug
           order by r.created_at desc limit 50`
        );
    const { rows: projects } = await pg.query(
      `select slug, display_name from handoff_projects where codereview_enabled = true order by display_name`
    );
    return { reports: rows, projects };
  } catch (error) {
    console.error("Erro ao obter dados de Code Review", error);
    return { error: "Failed to load Code Review data", reports: [], projects: [] };
  }
}

export async function getCodeReviewReport(id: number) {
  const { rows } = await pg.query(
    `select r.*, p.display_name from codereview_reports r
     join handoff_projects p on p.slug = r.project_slug
     where r.id = $1`,
    [id]
  );
  return rows[0] || null;
}
