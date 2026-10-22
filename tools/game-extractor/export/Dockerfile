# Експортер на CUE4Parse (рідна архітектура: на Маці — arm64, на сервері — x64; Oodle — керований, без нативних бібліотек).
# Збирання: docker build -t sandwalkers/gd-export:2 tools/game-extractor/export
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG CUE4PARSE_COMMIT=6f7b06eefa22f3cc259d03bb9901a384cb4fb538
WORKDIR /src
RUN git clone https://github.com/FabianFG/CUE4Parse.git CUE4Parse && git -C CUE4Parse checkout "$CUE4PARSE_COMMIT"
COPY Gdx.Export.csproj Program.cs gdx/
RUN dotnet publish gdx/Gdx.Export.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:10.0
COPY --from=build /app /app
ENTRYPOINT ["dotnet", "/app/gdx-export.dll"]
