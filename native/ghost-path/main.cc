// The path a ghost drives, frame by frame, from Kinoko's reimplementation of the game's physics.
//
//   ghost-path <ghost.rkg> <out.path>
//
// Run with KINOKO_FILESYSTEM_ROOT (or the working folder) at the extracted game's files, holding
// Race/Common.szs and Race/Course. Writes one row per frame of the ghost, as twelve little-endian
// floats: the frame (0 as the countdown starts, as the game's own counter and the ghost's buttons),
// the kart's place x, y, z, its rotation as a quaternion x, y, z, w, and what it is doing: its drift
// (0 none, 1 drifting, 2 mini-turbo charged, 3 super mini-turbo charged), its boost (0 none, 1 a
// mini-turbo's, 2 a mushroom's, 3 a ramp's or zipper's), 1 in the air, 1 in a wheelie. The exit code says whether the
// race ended on the ghost's own finish time: 0 it did, 2 it did not (the path went elsewhere than
// the game's), 1 something could not be read. When it did not, the output says from where: "lap N"
// for the first lap whose time differs from the ghost's, or "finish".
#include "host/SceneCreatorDynamic.hh"
#include "host/KSystem.hh"

#include <abstract/File.hh>
#include <egg/core/ExpHeap.hh>
#include <egg/core/SceneManager.hh>
#include <game/kart/KartMove.hh>
#include <game/kart/KartObjectManager.hh>
#include <game/kart/KartState.hh>
#include <game/system/RaceConfig.hh>
#include <game/system/RaceManager.hh>

#include <cstdio>
#include <vector>

#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
#include <immintrin.h>
#endif

using namespace Kinoko;

namespace {

class PathSystem : public KSystem {
public:
    void init() override {
        auto *creator = EGG::egg_new<Host::SceneCreatorDynamic>();
        m_scenes = EGG::egg_new<EGG::SceneManager>(creator);
        System::RaceConfig::RegisterInitCallback(OnInit, this);
        m_scenes->changeScene(0);
    }

    void calc() override {
        m_scenes->calc();
    }

    bool run() override {
        constexpr u32 MAX_FRAMES = 10 * 60 * 60;
        s32 frame = -1;
        for (u32 step = 0; step < MAX_FRAMES; ++step) {
            calc();
            const auto *race = System::RaceManager::Instance();
            if (race->stage() == System::RaceManager::Stage::FinishGlobal) {
                break;
            }
            // Counted from the countdown, as the ghost's buttons are.
            if (race->stage() == System::RaceManager::Stage::Intro) {
                continue;
            }
            ++frame;
            const auto *kart = Kart::KartObjectManager::Instance()->object(0);
            const auto &pos = kart->pos();
            const auto &rot = kart->fullRot();
            const auto &status = kart->state()->status();
            using Kart::eStatus;
            const bool drifting = status.onBit(eStatus::DriftManual, eStatus::DriftAuto);
            float drift = 0;
            if (drifting) {
                switch (kart->move()->driftState()) {
                case Kart::KartMove::DriftState::ChargedSmt:
                    drift = 3;
                    break;
                case Kart::KartMove::DriftState::ChargedMt: // also ChargingSmt: the same value
                    drift = 2;
                    break;
                default:
                    drift = 1;
                    break;
                }
            }
            float boost = 0;
            if (status.onBit(eStatus::RampBoost, eStatus::ZipperBoost)) {
                boost = 3;
            } else if (status.onBit(eStatus::MushroomBoost)) {
                boost = 2;
            } else if (status.onBit(eStatus::Boost)) {
                boost = 1;
            }
            const float air = status.onBit(eStatus::TouchingGround) ? 0.0f : 1.0f;
            const float wheelie = status.onBit(eStatus::Wheelie) ? 1.0f : 0.0f;
            const float row[12] = {static_cast<float>(frame), pos.x, pos.y, pos.z, rot.v.x, rot.v.y,
                    rot.v.z, rot.w, drift, boost, air, wheelie};
            m_rows.insert(m_rows.end(), row, row + 12);
        }
        const auto *race = System::RaceManager::Instance();
        if (race->stage() != System::RaceManager::Stage::FinishGlobal) {
            std::puts("lap 1");
            return false;
        }
        for (size_t i = 0; i < 3; ++i) {
            if (m_ghost->lapTimer(i) != race->player().getLapSplit(i + 1)) {
                std::printf("lap %zu\n", i + 1);
                return false;
            }
        }
        if (m_ghost->raceTimer() != race->player().raceTimer()) {
            std::puts("finish");
            return false;
        }
        return true;
    }

    void parseOptions(int argc, char **argv) override {
        if (argc < 2) {
            PANIC("Usage: ghost-path <ghost.rkg> <out.path>");
        }
        m_raw = Abstract::File::LoadHost(argv[0], m_rawSize);
        if (m_rawSize < System::RKG_HEADER_SIZE || m_rawSize > sizeof(System::RawGhostFile)) {
            PANIC("Not a ghost file");
        }
        System::RawGhostFile file = System::RawGhostFile(m_raw);
        m_ghost = EGG::egg_new<System::GhostFile>(file);
        m_out = argv[1];
    }

    bool write() const {
        FILE *out = std::fopen(m_out, "wb");
        if (!out) {
            return false;
        }
        std::fwrite(m_rows.data(), sizeof(float), m_rows.size(), out);
        return std::fclose(out) == 0;
    }

private:
    static void OnInit(System::RaceConfig *config, void *arg) {
        auto *self = static_cast<PathSystem *>(arg);
        config->setGhost(self->m_raw);
        config->raceScenario().players[0].type = System::RaceConfig::Player::Type::Ghost;
    }

    EGG::SceneManager *m_scenes = nullptr;
    const u8 *m_raw = nullptr;
    size_t m_rawSize = 0;
    const System::GhostFile *m_ghost = nullptr;
    const char *m_out = nullptr;
    std::vector<float> m_rows;
};

} // namespace

int main(int argc, char **argv) {
#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
    _MM_SET_DENORMALS_ZERO_MODE(_MM_DENORMALS_ZERO_ON);
#endif
    void *space = malloc(MEMORY_SPACE_SIZE);
    EGG::Heap *root = EGG::ExpHeap::create(space, MEMORY_SPACE_SIZE, DEFAULT_OPT);
    root->setName("EGGRoot");
    root->becomeCurrentHeap();
    EGG::SceneManager::SetRootHeap(root);

    auto *system = EGG::egg_new<PathSystem>();
    system->parseOptions(argc - 1, argv + 1);
    system->init();
    const bool synced = system->run();
    if (!system->write()) {
        return 1;
    }
    return synced ? 0 : 2;
}
