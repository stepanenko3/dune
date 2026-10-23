// Експортер файлів сервера Dune: Awakening (CUE4Parse): таблиці → JSON, .locres → JSON, станції крафту, список пакетів, рівні мапи.
// gdx-export tables <пакет>… | locres | stations <пакет CDT_PlaceableData> | files | levels <рівень>… | bytes <пакет>…
// Паки — GDX_PAKS (/paks), usmap — GDX_USMAP (/map.usmap), вихід — GDX_OUT (/out).
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports.Engine;
using CUE4Parse.UE4.Localization;
using CUE4Parse.UE4.Readers;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

var paks = Environment.GetEnvironmentVariable("GDX_PAKS") ?? "/paks";
var usmap = Environment.GetEnvironmentVariable("GDX_USMAP") ?? "/map.usmap";
var outDir = Environment.GetEnvironmentVariable("GDX_OUT") ?? "/out";
if (args.Length == 0) { Console.Error.WriteLine("gdx-export tables <пакет>… | locres | stations <пакет>"); return 1; }

// таблиці в Dune теговані: у тегу мапи нема типу структури-ключа, і без підказки CUE4Parse мовчки віддає null
// (інгредієнти й вихід рецептів, ціни будівництва) — явні підказки, далі всі мапи зі структурою-ключем з usmap
var mapKeys = new Dictionary<string, KeyValuePair<string, string?>>
{
    ["Outcome"] = new("EItemTemplateID", null),
    ["Ingredients"] = new("EItemTemplateID", null),
    ["m_BuildableTierData"] = new("EBuildableTier", "BuildableTierData"),
    ["BaseAdditionalCurrencyPrices"] = new("ECurrency", null),
};
var provider = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly, new VersionContainer(EGame.GAME_DuneAwakening, mapStructTypesOverrides: mapKeys!));
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap);
provider.Initialize();
provider.Mount();
{
    var seen = new Dictionary<string, KeyValuePair<string, string?>>();
    var clash = new HashSet<string>();
    foreach (var t in provider.MappingsForGame!.Types.Values)
        foreach (var pi in t.Properties.Values)
            if (pi.MappingType.Type == "MapProperty" && pi.MappingType.InnerType?.Type == "StructProperty")
            {
                var kv = new KeyValuePair<string, string?>(pi.MappingType.InnerType.StructType!, pi.MappingType.ValueType?.StructType);
                if (seen.TryGetValue(pi.Name, out var old) && old.Key != kv.Key) clash.Add(pi.Name); else seen[pi.Name] = kv;
            }
    foreach (var (n, kv) in seen)
        if (!clash.Contains(n) && !provider.Versions.MapStructTypes.ContainsKey(n)) provider.Versions.MapStructTypes[n] = kv!;
}

string Json(object o) => JsonConvert.SerializeObject(o, Formatting.Indented);
void Write(string rel, string text)
{
    var f = Path.Combine(outDir, rel);
    Directory.CreateDirectory(Path.GetDirectoryName(f)!);
    File.WriteAllText(f, text);
}
/// «/Game/Dune/X/BP_Y.BP_Y_C» чи «/Game/Dune/X/BP_Y.1» → «/Game/Dune/X/BP_Y»
static string PackageOf(string objectPath) { var i = objectPath.LastIndexOf('.'); return i > 0 ? objectPath[..i] : objectPath; }

switch (args[0])
{
    case "tables":
        // кожен пакет окремо: зламаний — свій .error, решта йде далі
        foreach (var pkg in args.Skip(1))
            try { Write(Path.Combine("tables", Path.GetFileName(pkg) + ".json"), Json(provider.LoadPackage(pkg).GetExports())); }
            catch (Exception e) { Write(Path.Combine("tables", Path.GetFileName(pkg) + ".error"), e.Message); }
        break;

    case "bytes":
        // сирі байти пакета (.uasset разом із даними поза властивостями — напр. біти BitMapData: зони луту, теги
        // подій), bytes/<ім'я>.bin; зламаний — .error
        foreach (var pkg in args.Skip(1))
            try
            {
                var f = Path.Combine(outDir, "bytes", Path.GetFileName(pkg) + ".bin");
                Directory.CreateDirectory(Path.GetDirectoryName(f)!);
                File.WriteAllBytes(f, provider.SaveAsset(pkg + ".uasset"));
            }
            catch (Exception e) { Write(Path.Combine("bytes", Path.GetFileName(pkg) + ".error"), e.Message); }
        break;

    case "files":
        // список пакетів збірки (шляхи без розширення .uexp/.ubulk) — з нього видобувач бере регіони, блоки й рівні
        Write("files.txt", string.Join("\n", provider.Files.Keys.Where((k) => k.EndsWith(".umap") || k.EndsWith(".uasset")).OrderBy((k) => k, StringComparer.Ordinal)));
        break;

    case "levels":
        // рівні мапи стисло: актори (клас, ім'я, трансформ кореня, дрібні властивості; блоки — усі властивості)
        // і точки ResourceNodeData; рівень — levels/<шлях через ~>.json (імена рівнів у різних теках бувають однакові:
        // «DuneSandbox/Content/Dune/A/B.umap» → «Dune~A~B»), зламаний — .error
        foreach (var pkg in args.Skip(1))
        {
            var name = Path.ChangeExtension(pkg, null).Replace("DuneSandbox/Content/", "").Replace('/', '~');
            try { Write(Path.Combine("levels", name + ".json"), Level(provider, pkg)); }
            catch (Exception e) { Write(Path.Combine("levels", name + ".error"), e.Message); }
        }
        break;

    case "locres":
        // тека мови гри → код сайту
        var langs = new Dictionary<string, string> { ["zh-CN"] = "zh-Hans", ["zh-TW"] = "zh-Hant" };
        foreach (var dir in new[] { "de", "en", "es", "fr", "it", "ja", "ko", "pl", "pt-BR", "ru", "tr", "uk", "zh-CN", "zh-TW" })
        {
            var code = langs.GetValueOrDefault(dir) ?? dir;
            // мова, що не прочиталась, — свій .error, інші мови йдуть далі
            try
            {
                var p = $"DuneSandbox/Content/Localization/Game/{dir}/Game.locres";
                var res = new FTextLocalizationResource(new FByteArchive(p, provider.SaveAsset(p), provider.Versions));
                var o = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
                foreach (var (ns, entries) in res.Entries)
                {
                    var d = o[ns.Str] = new(StringComparer.Ordinal);
                    foreach (var (k, e) in entries) d[k.Str] = e.LocalizedString;
                }
                Write(Path.Combine("loc", code + ".json"), Json(o));
            }
            catch (Exception e) { Write(Path.Combine("loc", code + ".error"), e.Message); }
        }
        break;

    case "stations":
        // пристрій → його BP (m_Placeable) → компонент крафту m_SupportedProductionTypes; нема — у батьківському BP
        var cache = new Dictionary<string, JArray>();
        JArray ExportsOf(string pkg) => cache.TryGetValue(pkg, out var a) ? a : cache[pkg] = JArray.Parse(JsonConvert.SerializeObject(provider.LoadPackage(pkg).GetExports()));
        List<string>? TypesOf(string pkg, int depth = 0)
        {
            if (depth > 12) return null;
            JArray ex;
            try { ex = ExportsOf(pkg); } catch { return null; }
            foreach (var e in ex)
                if (e["Properties"]?["m_SupportedProductionTypes"] is JArray types)
                    return types.Select((t) => (string?)t["Name"]).Where((n) => !string.IsNullOrEmpty(n)).Select((n) => n!).ToList();
            var cls = ex.FirstOrDefault((e) => (string?)e["Type"] == "BlueprintGeneratedClass");
            var super = (string?)(cls?["Super"]?["ObjectPath"] ?? cls?["SuperStruct"]?["ObjectPath"]);
            return super != null && super.StartsWith("/Game/") ? TypesOf(PackageOf(super), depth + 1) : null;
        }
        var table = provider.LoadPackage(args[1]).GetExports().OfType<UDataTable>().FirstOrDefault()
            ?? throw new InvalidOperationException($"у {args[1]} нема таблиці");
        var result = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var (name, row) in table.RowMap)
        {
            var placeable = JObject.Parse(JsonConvert.SerializeObject(row))["m_Placeable"]?["AssetPathName"]?.ToString();
            if (string.IsNullOrEmpty(placeable) || placeable == "None") continue;
            var types = TypesOf(PackageOf(placeable));
            if (types is { Count: > 0 }) result[name.Text] = types;
        }
        Write("stations.json", Json(result));
        break;

    default:
        Console.Error.WriteLine($"невідома команда: {args[0]}");
        return 1;
}
return 0;

/// рівень → { actors: [{ c, n, l, r, s, p }], nodes: [{ k, pts: [[x, y, z, core?]] }] }: трансформ — корінь актора (у
/// просторі рівня), p — властивості до 4 КБ без посилань на компоненти рівня (у блоків — усі: перевизначення вкладених)
static string Level(DefaultFileProvider provider, string pkg)
{
    var ex = JArray.Parse(JsonConvert.SerializeObject(provider.LoadPackage(pkg).GetExports()));
    static JToken? G(JToken? t, string k) => t is JObject o ? o[k] : null;
    static string Inner(string s) { var a = s.IndexOf('\''); var b = s.LastIndexOf('\''); return a >= 0 && b > a ? s[(a + 1)..b] : s; }
    static double[]? V(JToken? t, string a, string b, string c) => t is JObject o ? new[] { Math.Round((double?)o[a] ?? 0, 1), Math.Round((double?)o[b] ?? 0, 1), Math.Round((double?)o[c] ?? 0, 1) } : null;
    var byPath = new Dictionary<string, JObject>();
    foreach (var e in ex.OfType<JObject>())
        if ((string?)G(e["Outer"], "ObjectName") is string outer) byPath[Inner(outer) + "." + (string?)e["Name"]] = e;
    var actors = new List<object>();
    var nodes = new List<object>();
    foreach (var e in ex.OfType<JObject>())
    {
        var type = (string?)e["Type"];
        var props = e["Properties"] as JObject;
        if (type == "ResourceNodeData")
        {
            foreach (var z in G(props, "m_Zones") as JArray ?? new JArray())
                foreach (var g in G(z, "Groups") as JArray ?? new JArray())
                    foreach (var cl in G(G(g, "Value"), "Clusters") as JArray ?? new JArray())
                        nodes.Add(new
                        {
                            k = (string?)G(g, "Key"),
                            pts = (G(cl, "Points") as JArray ?? new JArray()).Select((p) =>
                            {
                                var l = V(G(p, "Location"), "X", "Y", "Z") ?? new double[3];
                                return new object[] { l[0], l[1], l[2], ((string?)G(p, "Type"))?.EndsWith("Core") == true ? 1 : 0 };
                            }).ToList(),
                        });
            continue;
        }
        if ((string?)G(G(props, "RootComponent"), "ObjectName") is not string root || props == null) continue;
        byPath.TryGetValue(Inner(root), out var rc);
        var rp = G(rc, "Properties");
        var keep = new JObject();
        var block = type == "BP_TerrainBlockActor_C";
        foreach (var p in props.Properties())
        {
            if (p.Name == "RootComponent" || ((string?)G(p.Value, "ObjectName"))?.Contains(":PersistentLevel.") == true) continue;
            if (block || p.Value.ToString(Formatting.None).Length <= 4000) keep[p.Name] = p.Value;
        }
        actors.Add(new { c = type, n = (string?)e["Name"], l = V(G(rp, "RelativeLocation"), "X", "Y", "Z"), r = V(G(rp, "RelativeRotation"), "Pitch", "Yaw", "Roll"), s = V(G(rp, "RelativeScale3D"), "X", "Y", "Z"), p = keep });
    }
    return JsonConvert.SerializeObject(new { actors, nodes });
}
