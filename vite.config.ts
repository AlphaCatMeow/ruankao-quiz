import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

/**
 * 微信小程序构建时把项目根的 cloudfunctions/ 复制到产物目录（dist/build/mp-weixin/cloudfunctions/），
 * 配合 manifest.json 里 mp-weixin.cloudfunctionRoot = "cloudfunctions/"，
 * 让微信开发者工具打开产物目录时能识别并部署云函数。
 * 不复制 test/ 和 node_modules/（依赖在部署时云端安装）。
 * cloudfunctions/ 是源文件，产物里的是副本：在开发者工具里改云函数代码不会写回源文件。
 */
function copyCloudFunctions(): Plugin {
  const SKIP = new Set(["node_modules", "test"]);
  const copyDir = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) copyDir(src, dst);
      else if (entry.isFile()) fs.copyFileSync(src, dst);
    }
  };
  return {
    name: "copy-cloudfunctions",
    apply: () => process.env.UNI_PLATFORM === "mp-weixin",
    closeBundle() {
      const src = path.resolve(__dirname, "cloudfunctions");
      const outDir = process.env.UNI_OUTPUT_DIR;
      if (!outDir || !fs.existsSync(src)) return;
      const dst = path.join(outDir, "cloudfunctions");
      fs.rmSync(dst, { recursive: true, force: true });
      copyDir(src, dst);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni(), copyCloudFunctions()],
});
