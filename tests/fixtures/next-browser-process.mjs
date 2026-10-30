// Match Next's client process fallback when a standalone component bundle runs
// without the framework bootstrap. Keep the actual implementation, not a mock.
import process from "next/dist/compiled/process";
export { process };
