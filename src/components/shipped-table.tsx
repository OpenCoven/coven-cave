"use client";

import { useMemo, useState } from "react";
import type { MergedPr } from "@/lib/daily-report-facts";
import {
  filterShippedRows,
  sortShippedRows,
  nextShippedSort,
  type ShippedSort,
  type ShippedSortKey,
} from "@/lib/shipped-table";
import { relativeTime } from "@/lib/relative-time";
import { Icon } from "@/lib/icon";

function ColButton({
  label,
  sortKey,
  sort,
  onClick,
}: {
  label: string;
  sortKey: ShippedSortKey;
  sort: ShippedSort;
  onClick: () => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <button type="button" onClick={onClick}>
      {label}
      {active && (
        <Icon
          name={sort!.dir === "asc" ? "ph:caret-up" : "ph:caret-down"}
          aria-hidden
        />
      )}
    </button>
  );
}

export function ShippedTable({
  rows,
  nowMs,
}: {
  rows: readonly MergedPr[];
  nowMs: number;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ShippedSort>(null);

  const visible = useMemo(
    () => sortShippedRows(filterShippedRows(rows, query), sort),
    [rows, query, sort],
  );

  const advance = (key: ShippedSortKey) =>
    setSort((s) => nextShippedSort(s, key));

  const ariaSort = (key: ShippedSortKey): "ascending" | "descending" | "none" =>
    sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";

  return (
    <div className="dr-shipped">
      <div className="dr-shipped__toolbar">
        <input
          type="search"
          className="dr-shipped__search"
          placeholder="Filter shipped work…"
          aria-label="Filter merged pull requests by title, repository, or PR number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="dr-shipped__count" role="status">
          {visible.length} / {rows.length}
        </span>
      </div>
      <div
        className="dr-shipped__viewport"
        tabIndex={0}
        aria-label="Merged pull requests table"
      >
        <table className="dr-shipped__table">
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort("pr")}>
                <ColButton
                  label="Pull request"
                  sortKey="pr"
                  sort={sort}
                  onClick={() => advance("pr")}
                />
              </th>
              <th scope="col" aria-sort={ariaSort("repo")}>
                <ColButton
                  label="Repository"
                  sortKey="repo"
                  sort={sort}
                  onClick={() => advance("repo")}
                />
              </th>
              <th scope="col" aria-sort={ariaSort("merged")}>
                <ColButton
                  label="Merged"
                  sortKey="merged"
                  sort={sort}
                  onClick={() => advance("merged")}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={3} className="dr-shipped__empty">
                  No shipped work matches this filter.
                </td>
              </tr>
            ) : (
              visible.map((pr) => (
                <tr key={`${pr.repo}#${pr.number}`}>
                  <td>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      title={pr.title}
                    >
                      {pr.title}
                    </a>
                  </td>
                  <td className="dr-shipped__repo">
                    {pr.repo}#{pr.number}
                  </td>
                  <td className="dr-shipped__time">
                    {relativeTime(pr.mergedAt, nowMs)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
